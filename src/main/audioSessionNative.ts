// audioSessionNative — read THIS APP's own WASAPI audio session (mute + volume + which device)
// through koffi, so the app can answer "am I muted in your volume mixer?" instead of guessing.
//
// WHY THIS EXISTS (JOS-442). The owner's alert audio went completely silent while every layer the
// app could see was healthy, and the app had no way to look at the layer it could not see: the
// Windows audio stack. The three hypotheses on the table — a per-app mute in the volume mixer, a
// stale device binding after a device change, exclusive-mode capture — are all facts Windows will
// state plainly if asked, and none of them are visible from a renderer. This module is the asking.
//
// WHY koffi AND NOT AN ADDON. Same argument as `presenceNative.ts` (read its header for the long
// form): koffi 2.x is already a dependency, ships N-API prebuilts, and needs no node-gyp in the
// packaging path. What is different here is the SHAPE of the call — WASAPI has no flat C API, only
// COM interfaces — so this file does COM vtable dispatch by hand: read the vtable pointer at
// offset 0 of an interface, read slot N out of it, and call it with `koffi.call` through a
// declared `koffi.proto`. That is three lines (`slot`, `vcall`, `outIface`) and everything else
// is a slot number with a comment saying which method it is.
//
// WHERE IT RUNS. On MAIN, not on a worker — unlike presence, which polls 69 times a second and
// therefore had to move off the thread that tails the log. This runs when a person presses a
// button, takes ~2 ms, and would cost more in worker plumbing than it can ever cost in latency.
// The price of that choice is that a wrong slot number is a crash rather than a dead feature, so
// every slot below was verified against the real machine before it shipped, and every call's
// HRESULT is checked before its out-parameter is read.
//
// WHAT IT NEVER DOES: write. There is no SetMute, no SetMasterVolume, no endpoint change. The app
// reports what it finds and lets the owner decide; silently un-muting somebody's mixer would be
// the app making a decision about their machine that they did not ask for.
//
// FAILURE IS AN ANSWER, NOT AN ERROR. Every path returns `{ available: false, reason }`: a
// non-Windows build, a koffi binary this machine will not map, a COM call that refused. The card
// that reads this renders the reason and carries on, because the renderer-side evidence (did the
// fetch work, did play() resolve) is useful on its own.

import * as koffi from 'koffi'
import type {
  AudioDeviceState,
  AudioSessionReadout,
  AudioSessionState,
  OwnAudioSession
} from '../shared/audioCheck'

// --------------------------------------------------------------------- the typed FFI boundary
//
// koffi's own signatures are `any`-shaped, which is honest at an FFI boundary and would otherwise
// spray `no-unsafe-*` across every line below. They are narrowed ONCE, here, into "unknown in,
// unknown out" — and the handful of coercers underneath are the only place a Win32 value is
// interpreted. Same arrangement as presenceNative.ts, for the same reason.

/**
 * An opaque COM interface pointer, as koffi hands it back.
 *
 * `NonNullable<unknown>` rather than `unknown`, on purpose: a bare `unknown` swallows the `| null`
 * in every `Iface | null` below, and the ONE thing this file must keep straight is which pointers
 * have been checked. Nothing reads through this type — it is a "some object koffi gave us" token.
 */
type Iface = NonNullable<unknown>

const koffiCall = koffi.call as (fn: Iface, proto: unknown, ...args: unknown[]) => unknown
const koffiDecode = koffi.decode as (from: Iface, offset: number, type: string) => unknown

/** koffi hands back `null` for a NULL pointer; everything else is a pointer we may call through. */
function asIface(v: unknown): Iface | null {
  return v ?? null
}

const S_OK = 0
/** CLSCTX_ALL — the value every WASAPI sample passes. */
const CLSCTX_ALL = 23

/** `{aabbccdd-eeff-…}` → the 16 raw bytes Windows expects (first three fields little-endian). */
function guid(text: string): Buffer {
  const hex = text.replace(/[{}-]/g, '')
  const b = Buffer.alloc(16)
  b.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0)
  b.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4)
  b.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6)
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16)
  return b
}

const CLSID_MMDeviceEnumerator = guid('{BCDE0395-E52F-467C-8E3D-C4579291692E}')
const IID_IMMDeviceEnumerator = guid('{A95664D2-9614-4F35-A746-DE8DB63617E6}')
const IID_IAudioSessionManager2 = guid('{77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F}')
const IID_IAudioSessionControl2 = guid('{BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D}')
const IID_ISimpleAudioVolume = guid('{87CE5498-68D6-44E5-9215-6DA47EF883D8}')
const IID_IAudioEndpointVolume = guid('{5CDF2C82-841E-4546-9722-0CF74078229A}')
/** PKEY_Device_FriendlyName — a PROPERTYKEY is a GUID plus a DWORD id, 20 bytes on the wire. */
const PKEY_DEVICE_FRIENDLY_NAME = ((): Buffer => {
  const key = Buffer.alloc(20)
  guid('{A45C254E-DF1C-4EFD-8020-67D146A850E0}').copy(key, 0)
  key.writeUInt32LE(14, 16)
  return key
})()
/** VT_LPWSTR — the only PROPVARIANT type this file is willing to read a string out of. */
const VT_LPWSTR = 31

/** The prototypes every vtable call below is made through. `__stdcall` is the x64 default. */
interface Protos {
  qi: unknown
  release: unknown
  outPtr: unknown
  outI32: unknown
  outU32: unknown
  outF32: unknown
  iOutPtr: unknown
  iiOutPtr: unknown
  activate: unknown
  openProps: unknown
  getValue: unknown
}

/**
 * The prototypes and the ole32 bindings, built ONCE.
 *
 * `koffi.proto` registers a NAMED type in a process-wide table, so building these twice throws
 * `duplicate type name` — MEASURED: the second call to `readOwnAudioSession` in one process
 * returned `available:false` until this became a singleton, which is exactly the sort of failure
 * a diagnostic must not have (the button works once and then reports that Windows is broken).
 */
let loaded: { ole: Ole32; p: Protos } | null = null

function buildProtos(): Protos {
  return {
    qi: koffi.proto('int32 __stdcall FnQI(void *self, const uint8 *iid, _Out_ uint8 *out)'),
    release: koffi.proto('uint32 __stdcall FnRel(void *self)'),
    outPtr: koffi.proto('int32 __stdcall FnOP(void *self, _Out_ uint8 *out)'),
    outI32: koffi.proto('int32 __stdcall FnOI(void *self, _Out_ int32 *out)'),
    outU32: koffi.proto('int32 __stdcall FnOU(void *self, _Out_ uint32 *out)'),
    outF32: koffi.proto('int32 __stdcall FnOF(void *self, _Out_ float *out)'),
    iOutPtr: koffi.proto('int32 __stdcall FnIP(void *self, int32 i, _Out_ uint8 *out)'),
    iiOutPtr: koffi.proto('int32 __stdcall FnIIP(void *self, int32 a, int32 b, _Out_ uint8 *o)'),
    activate: koffi.proto(
      'int32 __stdcall FnAct(void *self, const uint8 *iid, uint32 ctx, void *p, _Out_ uint8 *o)'
    ),
    openProps: koffi.proto('int32 __stdcall FnOPS(void *self, uint32 access, _Out_ uint8 *out)'),
    getValue: koffi.proto('int32 __stdcall FnGV(void *self, const uint8 *key, _Out_ uint8 *pv)')
  }
}

// ------------------------------------------------------------------------- vtable dispatch
//
// A COM object is a pointer to a pointer to an array of function pointers. `slot` walks that:
// `*(void**)iface` is the vtable, `vtable[i]` is the method. Every interface below begins with
// IUnknown, so slots 0/1/2 are QueryInterface/AddRef/Release and the interface's own methods
// start at 3 — which is why every slot number in this file is "3 + the method's index".

function slot(iface: Iface, index: number): Iface | null {
  const vtbl = asIface(koffiDecode(iface, 0, 'void *'))
  if (vtbl === null) return null
  return asIface(koffiDecode(vtbl, index * 8, 'void *'))
}

/** A vtable call whose result is an HRESULT. A pointer we could not even read reads as failure. */
function vcall(iface: Iface, index: number, proto: unknown, ...args: unknown[]): number {
  const fn = slot(iface, index)
  if (fn === null) return -1
  const hr = koffiCall(fn, proto, iface, ...args)
  return typeof hr === 'number' ? hr : -1
}

/**
 * Call a slot whose LAST argument is an interface out-parameter and hand back the interface, or
 * null when the call failed. The out-parameter is an 8-byte Buffer rather than koffi's array
 * form because the same Buffer idiom then reads strings (`decode(buf, 0, 'str16')`), and one
 * idiom for every out-pointer is one fewer thing to get wrong at a boundary that segfaults.
 */
function outIface(iface: Iface, index: number, proto: unknown, ...args: unknown[]): Iface | null {
  const buf = Buffer.alloc(8)
  if (vcall(iface, index, proto, ...args, buf) !== S_OK) return null
  return asIface(koffiDecode(buf, 0, 'void *'))
}

/** Every interface this file takes is released; `release(null)` is a no-op so callers stay flat. */
function release(p: Protos, iface: Iface | null): void {
  if (iface !== null) vcall(iface, 2, p.release)
}

function deviceStateName(v: number): AudioDeviceState {
  if (v === 0x1) return 'active'
  if (v === 0x2) return 'disabled'
  if (v === 0x4) return 'notpresent'
  if (v === 0x8) return 'unplugged'
  return 'unknown'
}

function sessionStateName(v: number): AudioSessionState {
  if (v === 0) return 'inactive'
  if (v === 1) return 'active'
  if (v === 2) return 'expired'
  return 'unknown'
}

// ---------------------------------------------------------------------- "is this session ours?"

/**
 * The app's executable as an NT-namespace path SUFFIX — `\Users\…\electron.exe`, drive letter
 * removed — which is what `IAudioSessionControl2::GetSessionIdentifier` spells its half of the
 * comparison in (`\Device\HarddiskVolume4\Users\…\electron.exe%b{…}`).
 *
 * THE PID COMPARE ALONE IS WRONG AND WOULD HAVE MADE THIS FEATURE LIE (measured 2026-08-21):
 * Chromium opens its render streams from the AUDIO SERVICE utility process, so the mixer entry
 * for a Chromium app belongs to a child nobody outside the browser process knows the pid of.
 * Matching the image path catches every process in the app's own tree, because they are all the
 * same executable.
 *
 * THE HONEST LIMIT: in DEV the executable is `node_modules/electron/dist/electron.exe`, which a
 * second Electron dev app on the same machine also runs from. A packaged build runs its own
 * uniquely-named exe and has no such overlap.
 */
function ownImageSuffix(): string {
  const exe = process.execPath.replace(/^[A-Za-z]:/, '')
  return exe.toLowerCase()
}

function isOurs(sessionId: string, pid: number, suffix: string): boolean {
  if (pid === process.pid) return true
  const id = sessionId.toLowerCase()
  const cut = id.indexOf('%b')
  const path = cut >= 0 ? id.slice(0, cut) : id
  return suffix.length > 0 && path.endsWith(suffix)
}

// ------------------------------------------------------------------------------- the reading

/**
 * The three ole32 entry points, typed as "unknown in, unknown out" — the same narrowing
 * presenceNative.ts applies, and for the same reason: koffi cannot know what a prototype string
 * means, so the honest signature at the boundary is this one and the coercion happens above.
 *
 * `CoCreateInstance` takes FIVE arguments because Microsoft says so. `max-params` is a factoring
 * rule about functions this repo writes, and a foreign ABI is not one of those.
 */
type Ole32Fn = (...args: unknown[]) => unknown

interface Ole32 {
  CoInitializeEx: Ole32Fn
  CoCreateInstance: Ole32Fn
  CoUninitialize: Ole32Fn
}

function loadOle32(): Ole32 {
  const lib = koffi.load('ole32.dll')
  const bind = (proto: string): Ole32Fn => lib.func(proto) as Ole32Fn
  return {
    CoInitializeEx: bind('int32 __stdcall CoInitializeEx(void *reserved, uint32 dwCoInit)'),
    CoCreateInstance: bind(
      'int32 __stdcall CoCreateInstance(const uint8 *rclsid, void *pUnkOuter, uint32 dwClsContext, const uint8 *riid, _Out_ uint8 *ppv)'
    ),
    CoUninitialize: bind('void __stdcall CoUninitialize()')
  }
}

/** The default render endpoint's friendly name, or '' when the property store will not say. */
function friendlyName(p: Protos, device: Iface): string {
  const store = outIface(device, 4, p.openProps, 0) // IMMDevice::OpenPropertyStore
  if (store === null) return ''
  const pv = Buffer.alloc(24) // PROPVARIANT on x64: vt at 0, the union pointer at 8
  // IPropertyStore::GetValue. `decode(buf, 8, 'str16')` reads the LPWSTR the union holds — the
  // same Buffer idiom every out-pointer in this file uses, and the reason none of them needs a
  // second dereference by hand.
  const hr = vcall(store, 5, p.getValue, PKEY_DEVICE_FRIENDLY_NAME, pv)
  const name =
    hr === S_OK && pv.readUInt16LE(0) === VT_LPWSTR ? koffiDecode(pv, 8, 'str16') : ''
  release(p, store)
  return typeof name === 'string' ? name : ''
}

/** One session's facts, or null when it is not ours. */
function readSessionIfOurs(p: Protos, sc: Iface, suffix: string): OwnAudioSession | null {
  const ctl2 = outIface(sc, 0, p.qi, IID_IAudioSessionControl2)
  let pid = -1
  let sid = ''
  if (ctl2 !== null) {
    const pidOut = [0]
    if (vcall(ctl2, 14, p.outU32, pidOut) === S_OK) pid = pidOut[0] // GetProcessId
    const idBuf = Buffer.alloc(8)
    if (vcall(ctl2, 12, p.outPtr, idBuf) === S_OK) {
      // GetSessionIdentifier
      const s = koffiDecode(idBuf, 0, 'str16')
      if (typeof s === 'string') sid = s
    }
    release(p, ctl2)
  }
  if (!isOurs(sid, pid, suffix)) return null

  const vol = outIface(sc, 0, p.qi, IID_ISimpleAudioVolume)
  let muted = false
  let volume = 1
  if (vol !== null) {
    const m = [0]
    const v = [0]
    if (vcall(vol, 6, p.outI32, m) === S_OK) muted = m[0] !== 0 // ISimpleAudioVolume::GetMute
    if (vcall(vol, 4, p.outF32, v) === S_OK) volume = v[0] // ::GetMasterVolume
    release(p, vol)
  }
  const st = [0]
  vcall(sc, 3, p.outI32, st) // IAudioSessionControl::GetState
  return { state: sessionStateName(st[0]), muted, volume }
}

/** Walk one endpoint's session list looking for ours. */
function findOurSession(p: Protos, device: Iface, suffix: string): OwnAudioSession | null {
  const mgr = outIface(device, 3, p.activate, IID_IAudioSessionManager2, CLSCTX_ALL, null)
  if (mgr === null) return null
  const list = outIface(mgr, 5, p.outPtr) // IAudioSessionManager2::GetSessionEnumerator
  if (list === null) {
    release(p, mgr)
    return null
  }
  const count = [0]
  vcall(list, 3, p.outI32, count)
  let found: OwnAudioSession | null = null
  for (let i = 0; i < count[0] && found === null; i++) {
    const sc = outIface(list, 4, p.iOutPtr, i) // ::GetSession
    if (sc === null) continue
    found = readSessionIfOurs(p, sc, suffix)
    release(p, sc)
  }
  release(p, list)
  release(p, mgr)
  return found
}

/** The default endpoint's own mute + volume (the master slider), read via IAudioEndpointVolume. */
function endpointVolume(p: Protos, device: Iface): { muted: boolean; volume: number } {
  const epv = outIface(device, 3, p.activate, IID_IAudioEndpointVolume, CLSCTX_ALL, null)
  if (epv === null) return { muted: false, volume: 1 }
  const m = [0]
  const v = [0]
  vcall(epv, 15, p.outI32, m) // ::GetMute
  vcall(epv, 9, p.outF32, v) // ::GetMasterVolumeLevelScalar
  release(p, epv)
  return { muted: m[0] !== 0, volume: v[0] }
}

/**
 * Look for our session on every ACTIVE render endpoint that is NOT the default one.
 *
 * Only reached when the default endpoint had no session for us, and only to answer one question:
 * is this app still holding a stream on the device the machine stopped using? That is the stale
 * device binding, and naming the old device is the difference between "restart the app" and a
 * shrug.
 */
function findOnOtherDevices(
  p: Protos,
  devEnum: Iface,
  defaultName: string,
  suffix: string
): { device: string; session: OwnAudioSession } | null {
  const col = outIface(devEnum, 3, p.iiOutPtr, 0, 0x1) // EnumAudioEndpoints(eRender, ACTIVE)
  if (col === null) return null
  const count = [0]
  vcall(col, 3, p.outI32, count) // IMMDeviceCollection::GetCount
  let hit: { device: string; session: OwnAudioSession } | null = null
  for (let i = 0; i < count[0] && hit === null; i++) {
    const dev = outIface(col, 4, p.iOutPtr, i) // ::Item
    if (dev === null) continue
    const name = friendlyName(p, dev)
    if (name !== defaultName) {
      const session = findOurSession(p, dev, suffix)
      if (session !== null) hit = { device: name || '(unnamed device)', session }
    }
    release(p, dev)
  }
  release(p, col)
  return hit
}

function readWithCom(p: Protos, ole: Ole32): AudioSessionReadout {
  const enumBuf = Buffer.alloc(8)
  const hr = ole.CoCreateInstance(
    CLSID_MMDeviceEnumerator,
    null,
    CLSCTX_ALL,
    IID_IMMDeviceEnumerator,
    enumBuf
  )
  if (hr !== S_OK) {
    return { available: false, reason: `MMDeviceEnumerator refused (0x${hexHr(hr)})` }
  }
  const devEnum = asIface(koffiDecode(enumBuf, 0, 'void *'))
  if (devEnum === null) {
    return { available: false, reason: 'MMDeviceEnumerator handed back nothing' }
  }
  // IMMDeviceEnumerator::GetDefaultAudioEndpoint(eRender=0, eConsole=0)
  const device = outIface(devEnum, 4, p.iiOutPtr, 0, 0)
  if (device === null) {
    release(p, devEnum)
    return { available: false, reason: 'Windows reports no default playback device' }
  }
  const suffix = ownImageSuffix()
  const deviceName = friendlyName(p, device)
  const st = [0]
  vcall(device, 6, p.outI32, st) // IMMDevice::GetState
  const master = endpointVolume(p, device)
  const session = findOurSession(p, device, suffix)
  const elsewhere = session === null ? findOnOtherDevices(p, devEnum, deviceName, suffix) : null
  release(p, device)
  release(p, devEnum)
  return {
    available: true,
    deviceName,
    deviceState: deviceStateName(st[0]),
    endpointMuted: master.muted,
    endpointVolume: master.volume,
    session: session ?? elsewhere?.session ?? null,
    sessionOnOtherDevice: elsewhere?.device ?? null
  }
}

function hexHr(hr: unknown): string {
  return typeof hr === 'number' ? (hr >>> 0).toString(16) : 'unknown'
}

/** RPC_E_CHANGED_MODE — COM is already up on this thread in the other apartment model. Fine. */
const RPC_E_CHANGED_MODE = -2147417850
/** S_FALSE — COM was already up on this thread in the SAME model; the count still went up. */
const S_FALSE = 1

function nativeLayer(): { ole: Ole32; p: Protos } {
  loaded ??= { ole: loadOle32(), p: buildProtos() }
  return loaded
}

/**
 * Read this app's audio session. NEVER THROWS — every failure becomes `available:false` with a
 * reason a person can read, because a diagnostic that can take the app down is worse than no
 * diagnostic at all.
 */
export function readOwnAudioSession(): AudioSessionReadout {
  if (process.platform !== 'win32') {
    return { available: false, reason: 'only Windows reports per-app audio state' }
  }
  try {
    const { ole, p } = nativeLayer()
    // COINIT_APARTMENTTHREADED. Electron has already initialised COM on this thread, so the
    // realistic answers are S_FALSE (already up, same model) and RPC_E_CHANGED_MODE (already up,
    // other model) — both usable. S_OK and S_FALSE both INCREMENT the thread's init count and
    // are therefore both balanced below; RPC_E_CHANGED_MODE increments nothing and must not be.
    const init = ole.CoInitializeEx(null, 2)
    const ours = init === S_OK || init === S_FALSE
    try {
      if (typeof init === 'number' && init < 0 && init !== RPC_E_CHANGED_MODE) {
        return { available: false, reason: `COM refused to start (0x${hexHr(init)})` }
      }
      return readWithCom(p, ole)
    } finally {
      if (ours) ole.CoUninitialize()
    }
  } catch (err) {
    const name = err instanceof Error ? err.message : String(err)
    return { available: false, reason: `the Windows audio interface could not be loaded: ${name}` }
  }
}

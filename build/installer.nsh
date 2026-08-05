# build/installer.nsh - auto-included by electron-builder (buildResources/installer.nsh
# is the default for `nsis.include`; no electron-builder.yml wiring needed).
#
# Why this exists: app-builder-lib's registryAddInstallInfo (templates/nsis/include/
# installer.nsh) writes InstallLocation only to INSTALL_REGISTRY_KEY
# (HKCU\Software\<appId-uuid>). The Add/Remove Programs key
# (HKCU\...\CurrentVersion\Uninstall\<appId-uuid>) gets DisplayName, DisplayVersion,
# Publisher, UninstallString, QuietUninstallString, DisplayIcon, EstimatedSize - but NOT
# InstallLocation, so Windows Settings -> Apps shows a blank install location. Mirror it.
#
# customInstall is inserted at the END of installSection.nsh, after registryAddInstallInfo
# and the shortcuts, so $INSTDIR and SHELL_CONTEXT are already correct (SHELL_CONTEXT is
# `current` for our per-user oneClick/perMachine:false install). The uninstaller's
# DeleteRegKey removes the whole key, so this adds nothing to clean up.
#
# NOTE: this file is included at the TOP of the generated .nsi, BEFORE multiUser.nsh
# defines UNINSTALL_REGISTRY_KEY. Spell the path out from UNINSTALL_APP_KEY (passed on
# the compiler command line by NsisTarget, so it exists from line 1) rather than relying
# on a define that does not exist yet at this point in the script.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation" "$INSTDIR"
!macroend

# ---------------------------------------------------------------------------------------
# customCheckAppRunning - skip the "app is running" gate under Wine / CrossOver.
#
# THE BUG: on macOS + CrossOver the installer dies at "EQ Legends Companion is running.
# Click OK to close it..." with the app NOT running. The stock check enumerates processes
# (PowerShell Get-CimInstance, else tasklist) and both are unreliable inside a Wine bottle -
# zombie/stale bottle processes, a wineserver that still lists an exited image, and a
# tasklist stub whose output is not the real process table. The user cannot get past it:
# KILL_PROCESS then cannot kill the thing FIND_PROCESS claims to see, so the retry loop
# escalates to appCannotBeClosed and Quit. Under Wine the check has no value anyway - the
# files we are about to overwrite are not actually locked by a phantom.
#
# THE HOOK, VERIFIED AGAINST THE INSTALLED app-builder-lib (26.15.7),
# templates/nsis/include/allowOnlyOneInstallerInstance.nsh:
#
#   !macro CHECK_APP_RUNNING
#     Var /GLOBAL CmdPath / PowerShellPath ... (set here, OUTSIDE the branch)
#     !ifmacrodef customCheckAppRunning
#       !insertmacro customCheckAppRunning        <- our body, and NOTHING else
#     !else
#       !insertmacro IS_POWERSHELL_AVAILABLE
#       !insertmacro _CHECK_APP_RUNNING
#     !endif
#   !macroend
#
# So the hook REPLACES, it does not wrap: defining it drops the entire default body. That
# is why the ${Else} branch below re-inserts EXACTLY the two macros the !else branch would
# have, rather than a copied-out body that could drift from the template on an upgrade. On
# real Windows the emitted code is therefore identical to today's.
#
# THE TRAP THAT COMES WITH THE HOOK (same file, lines 5-8):
#
#   !ifmacrondef customCheckAppRunning
#     !include "getProcessInfo.nsh"
#     Var pid
#   !endif
#
# ...i.e. app-builder-lib assumes a custom check does NOT want the default machinery and
# stops providing it. But we DO want it on Windows: _CHECK_APP_RUNNING calls
# ${GetProcessInfo} and KILL_PROCESS reads $pid. Since this file is included in the shared
# header ABOVE installer.nsi's `!include "allowOnlyOneInstallerInstance.nsh"`, that
# !ifmacrondef is already false by the time it is evaluated, and without the two lines below
# the build fails to compile (undefined ${GetProcessInfo} / unknown variable $pid). Both are
# safe here: getProcessInfo.nsh is self-guarded (GETPROCESSINFO_INCLUDED), resolves through
# the !addincludedir that NsisTarget emits before our !include, and its own
# `!ifdef BUILD_UNINSTALLER` picks un._GetProcessInfo in the uninstaller pass - BUILD_UNINSTALLER
# is a -D define, so it is correct from line 1. It needs nothing from multiUser.nsh/LogicLib,
# which is the AGENTS.md gotcha this file exists to remember: only TOP-LEVEL code here runs
# before those are defined. Everything inside a !macro body is expanded at the INSERTION
# point (inside the install section / un.checkAppRunning), where LogicLib, ${isUpdated},
# ${APP_EXECUTABLE_FILENAME} and friends all exist.
!include "getProcessInfo.nsh"
Var pid

# Probe one registry key for existence WITHOUT reading a value: Wine creates Software\Wine
# but there is no value under it we can count on, so ReadRegStr would false-negative and
# EnumRegKey cannot tell "no such key" from "key with no subkeys" (both set the error flag).
# RegOpenKeyExW answers exactly the question. $R9 is the sticky "is Wine" flag; each probe
# short-circuits if an earlier one already said yes.
!macro eqProbeWineRegKey ROOT SAM
  ${If} $R9 == 0
    System::Call 'advapi32::RegOpenKeyExW(i ${ROOT}, w "Software\Wine", i 0, i ${SAM}, *i .R8) i .R7'
    ${If} $R7 == 0
      System::Call 'advapi32::RegCloseKey(i R8)'
      StrCpy $R9 1
    ${EndIf}
  ${EndIf}
!macroend

# Belt and braces for a bottle whose registry has been scrubbed: ntdll!wine_get_version is
# Wine's own advertised "am I Wine" export and exists in every bottle, CrossOver included.
# GetProcAddress rather than System::Call on the function itself, because a missing export
# through System::Call has a fuzzier failure mode than a NULL pointer.
!macro eqProbeWineNtdll
  ${If} $R9 == 0
    System::Call 'kernel32::GetModuleHandleW(w "ntdll.dll") i .R8'
    ${If} $R8 != 0
      System::Call 'kernel32::GetProcAddress(i R8, m "wine_get_version") i .R7'
      ${If} $R7 != 0
        StrCpy $R9 1
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customCheckAppRunning
  # Build-time proof the hook fired, same trick as customUnInstall below. Prints once per
  # makensis pass (installer + uninstaller) with DEBUG=electron-builder. !verbose 4 is
  # required for !echo to print and is NOT a warning, so -WX stays happy.
  !verbose push
  !verbose 4
  !echo "everquest-companion: customCheckAppRunning inserted (Wine skip + default fallthrough)"
  !verbose pop

  # $R7/$R8/$R9 only. $R0/$R1 are the default check's scratch and $R9 is re-used by
  # ${isUpdated} inside it - all of that happens after the branch is decided.
  StrCpy $R9 0
  !insertmacro eqProbeWineRegKey 0x80000001 0x00020019  # HKCU, KEY_READ
  !insertmacro eqProbeWineRegKey 0x80000002 0x00020019  # HKLM, KEY_READ
  # HKLM\Software is WOW64-redirected for this 32-bit installer; ask for the 64-bit view too
  # (KEY_WOW64_64KEY, ignored on a 32-bit prefix).
  !insertmacro eqProbeWineRegKey 0x80000002 0x00020119
  !insertmacro eqProbeWineNtdll

  ${If} $R9 == 1
    # No Quit, no MessageBox, no kill: just fall through to the install/uninstall.
    # DetailPrint is the only trace mechanism the stock check uses too (see $(appClosing)).
    # oneClick hides the details pane, so this is visible in install.log only when the build
    # sets ENABLE_LOGGING_ELECTRON_BUILDER (electron-builder.yml
    # `nsis.customNsisBinary.debugLogging: true`) - i.e. exactly the debug-log case.
    DetailPrint "Wine/CrossOver detected - skipping the running-app check (process enumeration is not reliable in a bottle). Close EQ Legends Companion yourself if it is open."
  ${Else}
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  ${EndIf}
!macroend

# ---------------------------------------------------------------------------------------
# customUnInstall - "keep your settings?" prompt on INTERACTIVE uninstall only.
#
# electron-builder.yml keeps `deleteAppDataOnUninstall: false`, so the stock template
# never touches %APPDATA%. This macro is the ONLY code path that can delete user data,
# and it only runs when a human answered No to the question below.
#
# WHAT WAS VERIFIED about the uninstaller's macro context (app-builder-lib 25.x,
# templates/nsis/*), because almost none of it is what you would guess:
#
#  * `${Silent}` IS USELESS HERE. For a oneClick build, uninstaller.nsh's `un.onInit`
#    shows the stock "are you sure you want to uninstall" MB_OKCANCEL and then calls
#    `SetSilent silent` ("one-click installer executes uninstall section in the silent
#    mode"). By the time the `un.install` section - and therefore this macro - runs,
#    ${Silent} is TRUE for BOTH an interactive uninstall and a `/S` one. A
#    `${IfNot} ${Silent}` guard would compile fine and simply never fire, i.e. the
#    prompt would never appear. Detect the REAL request instead, from the command line:
#    `/S` present => scripted/silent => never prompt, always preserve.
#    (`${GetParameters}`/`${GetOptions}` come from FileFunc.nsh, which multiUser.nsh
#    includes near the top of the .nsi - long before this macro is inserted. The stock
#    section uses the same pair three lines above the insertion point to parse
#    `--delete-app-data`.) The relaunched-from-%TEMP% copy of the uninstaller keeps the
#    original command line - that is why `Uninstall*.exe /S` is silent end-to-end today,
#    and it is what the tier-2 sandbox harness relies on.
#  * `${isUpdated}` (StdUtils.TestParameter "--updated") IS available - the generated
#    header defines it above this file's include. electron-updater never uninstalls, but
#    an update-driven uninstall would also pass `/S`; both are checked, belt and braces.
#  * `$installMode` is multiUser.nsh's Var, set by `initMultiUser` in un.onInit. For our
#    per-user install it is "CurrentUser", so SHELL_CONTEXT is `current` and $APPDATA is
#    the real per-user roaming dir. The all-users guard mirrors the stock
#    DELETE_APP_DATA_ON_UNINSTALL block verbatim ("electron always uses per user app
#    data") so this stays correct if perMachine is ever flipped.
#  * customUnInstall is inserted at the END of the `un.install` section, AFTER
#    `RMDir /r $INSTDIR`, the shortcut removal and the DeleteRegKey calls, and just
#    before ONE_CLICK's quitSuccess. Files are already gone when the prompt appears;
#    that is fine (nothing here depends on $INSTDIR) and it is the only hook available.
#  * The dir name is spelled out, NOT taken from ${APP_PACKAGE_NAME}. `RMDir /r` on an
#    accidentally-empty define would be `RMDir /r "$APPDATA\"` - the entire roaming
#    profile. It must stay in sync with package.json `name` (= Electron's
#    app.getName(), there being no productName in package.json) and with the prod row of
#    src/main/channel.ts. NEVER widen this: `%APPDATA%\eq-tools` is the pre-rename
#    BACKUP that the one-time seed reads from, and `%APPDATA%\everquest-companion-dev`
#    is the running dev app's data. Neither is ours to delete.
!macro customUnInstall
  # Build-time proof that the hook actually fires. `!ifmacrodef customUnInstall` lives in
  # uninstaller.nsh, which is only !included in the -DBUILD_UNINSTALLER pass, so this line
  # prints exactly once per `npm run dist` (visible with DEBUG=electron-builder). If it
  # ever stops printing, electron-builder stopped inserting this macro and the prompt is
  # silently gone. !verbose 4 is needed for !echo to print at all; it is NOT a warning, so
  # makensis's -WX stays happy.
  !verbose push
  !verbose 4
  !echo "everquest-companion: customUnInstall inserted (keep-settings prompt is live)"
  !verbose pop

  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "/S" $R1
  ${IfNot} ${Errors}
    # /S on the command line: scripted or updater-driven. Preserve silently.
    Goto eqKeepUserData
  ${EndIf}
  ${If} ${isUpdated}
    Goto eqKeepUserData
  ${EndIf}

  # Interactive uninstall. Yes (default button, and the /SD fallback) keeps everything.
  # Deliberately ONE line: this file has a history of "compiles clean, installer dies",
  # and a line continuation inside a macro body is not worth re-litigating.
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1|MB_TOPMOST|MB_SETFOREGROUND "Keep your settings and history?$\r$\n$\r$\nThey'll be restored if you reinstall EQ Legends Companion.$\r$\n(Choosing No deletes them permanently.)" /SD IDYES IDYES eqKeepUserData

  ${If} $installMode == "all"
    SetShellVarContext current
  ${EndIf}
  RMDir /r "$APPDATA\everquest-companion"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}

  eqKeepUserData:
  # GetOptions leaves the error flag set when the switch is absent; don't hand that on.
  ClearErrors
!macroend

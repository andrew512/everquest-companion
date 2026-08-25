//! GENERATED FILE - DO NOT EDIT.
//!
//! Generated from protocol/schema/*.schema.json by `npm run gen:protocol`.
//! Edit the schema, run the generator, commit both sides.
//!
//! Neither language is privileged: this file and its TypeScript twin
//! (src/shared/dataServer/protocol.generated.ts) come from the same neutral JSON Schema,
//! and a schema edit that lands without regenerating turns the protocol-codegen staleness
//! test red on this side and tests/protocolSchema.test.mts red on the other.
//!
//! schema-digest: sha256:b52a7519a944d754c989534ed2895ad73f9213ad23a056b42c50a78a35bbaacb
#![allow(missing_docs, clippy::all, clippy::pedantic)]

/// Error types.
pub mod error {
    /// Error from a `TryFrom` or `FromStr` implementation.
    pub struct ConversionError(::std::borrow::Cow<'static, str>);
    impl ::std::error::Error for ConversionError {}
    impl ::std::fmt::Display for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Display::fmt(&self.0, f)
        }
    }
    impl ::std::fmt::Debug for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Debug::fmt(&self.0, f)
        }
    }
    impl From<&'static str> for ConversionError {
        fn from(value: &'static str) -> Self {
            Self(value.into())
        }
    }
    impl From<String> for ConversionError {
        fn from(value: String) -> Self {
            Self(value.into())
        }
    }
}
///One alert, EXACTLY AS THE STORE HOLDS IT — `src/shared/alertTypes.ts AlertDef`. The protocol states nothing about its shape, and that is the `ModuleState`/`Cells` argument at full strength rather than a shortcut. Two reasons, and the second is the load-bearing one. (1) The field set is the STORE's contract: a def carries an id, a name, an enabled flag, a trigger grammar and a sound reference that the engine's evaluator reads, plus volume, audio channel, speech phrase, banner colour, notes and the early-warning offset that belong entirely to the app — and an alert growing a field must not be a protocol change or turn a whole push into `badParams`. (2) A DEFINITION ROUND-TRIPS: the fold republishes the pushed list as the `alerts` module's own `defs`, which is what the app's alert list is drawn from, so a typed protocol shape that quietly dropped an unlisted field would REWRITE THE USER'S ALERTS as they passed through the engine. Typed-where-cheap is not cheap here. The engine reads what it needs with its own reader (`fold::modules::alerts_rules::Rule::compile`), exactly as the fold reads an event.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "AlertDefinition",
///  "description": "One alert, EXACTLY AS THE STORE HOLDS IT — `src/shared/alertTypes.ts AlertDef`. The protocol states nothing about its shape, and that is the `ModuleState`/`Cells` argument at full strength rather than a shortcut. Two reasons, and the second is the load-bearing one. (1) The field set is the STORE's contract: a def carries an id, a name, an enabled flag, a trigger grammar and a sound reference that the engine's evaluator reads, plus volume, audio channel, speech phrase, banner colour, notes and the early-warning offset that belong entirely to the app — and an alert growing a field must not be a protocol change or turn a whole push into `badParams`. (2) A DEFINITION ROUND-TRIPS: the fold republishes the pushed list as the `alerts` module's own `defs`, which is what the app's alert list is drawn from, so a typed protocol shape that quietly dropped an unlisted field would REWRITE THE USER'S ALERTS as they passed through the engine. Typed-where-cheap is not cheap here. The engine reads what it needs with its own reader (`fold::modules::alerts_rules::Rule::compile`), exactly as the fold reads an event.",
///  "type": "object",
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct AlertDefinition(pub ::serde_json::Map<::std::string::String, ::serde_json::Value>);
impl ::std::ops::Deref for AlertDefinition {
    type Target = ::serde_json::Map<::std::string::String, ::serde_json::Value>;
    fn deref(&self) -> &::serde_json::Map<::std::string::String, ::serde_json::Value> {
        &self.0
    }
}
impl ::std::convert::From<AlertDefinition>
    for ::serde_json::Map<::std::string::String, ::serde_json::Value>
{
    fn from(value: AlertDefinition) -> Self {
        value.0
    }
}
impl ::std::convert::From<::serde_json::Map<::std::string::String, ::serde_json::Value>>
    for AlertDefinition
{
    fn from(value: ::serde_json::Map<::std::string::String, ::serde_json::Value>) -> Self {
        Self(value)
    }
}
///`AlertsDefineParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "AlertsDefineParams",
///  "type": "object",
///  "required": [
///    "defs"
///  ],
///  "properties": {
///    "defs": {
///      "description": "THE WHOLE SET, always. Not a delta: a define replaces what the engine holds, so a crash-respawn is a replay of the latest push and a command input is hash-friendly.",
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/AlertDefinition"
///      }
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AlertsDefineParams {
    ///THE WHOLE SET, always. Not a delta: a define replaces what the engine holds, so a crash-respawn is a replay of the latest push and a command input is hash-friendly.
    pub defs: ::std::vec::Vec<AlertDefinition>,
}
///THE USER'S ALERT DEFINITIONS, pushed (boundary verdict 3). The store stays persistence truth app-side and the engine never reads a settings file; the app pushes the WHOLE set on connect and on every save/delete. Since ruling 22 the engine is also what EVALUATES them: a match on a LIVE event becomes a `FireMessage` on the stream, and the app-side alert system reduces to receive-fire-make-sound.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "AlertsDefineRequest",
///  "description": "THE USER'S ALERT DEFINITIONS, pushed (boundary verdict 3). The store stays persistence truth app-side and the engine never reads a settings file; the app pushes the WHOLE set on connect and on every save/delete. Since ruling 22 the engine is also what EVALUATES them: a match on a LIVE event becomes a `FireMessage` on the stream, and the app-side alert system reduces to receive-fire-make-sound.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "alerts.define"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/AlertsDefineParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AlertsDefineRequest {
    pub id: RequestId,
    pub op: AlertsDefineRequestOp,
    pub params: AlertsDefineParams,
}
///`AlertsDefineRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "alerts.define"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum AlertsDefineRequestOp {
    #[serde(rename = "alerts.define")]
    AlertsDefine,
}
impl ::std::fmt::Display for AlertsDefineRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::AlertsDefine => f.write_str("alerts.define"),
        }
    }
}
impl ::std::str::FromStr for AlertsDefineRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "alerts.define" => Ok(Self::AlertsDefine),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for AlertsDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for AlertsDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for AlertsDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`AttachResult`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "AttachResult",
///  "type": "object",
///  "required": [
///    "accepted",
///    "epoch"
///  ],
///  "properties": {
///    "accepted": {
///      "description": "False when the attach was preempted by a later one before it began — the caller's own attach is the one that lost, and the epoch names the winner.",
///      "type": "boolean"
///    },
///    "epoch": {
///      "$ref": "#/$defs/Epoch"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AttachResult {
    ///False when the attach was preempted by a later one before it began — the caller's own attach is the one that lost, and the epoch names the winner.
    pub accepted: bool,
    pub epoch: Epoch,
}
///`BuffTrustDefineParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "BuffTrustDefineParams",
///  "type": "object",
///  "required": [
///    "trust"
///  ],
///  "properties": {
///    "trust": {
///      "$ref": "#/$defs/BuffTrustPrefs"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct BuffTrustDefineParams {
    pub trust: BuffTrustPrefs,
}
///WHOSE CASTS, BESIDES YOUR OWN, MAY ANCHOR A LANDING (JOS-140). Pushed like every other piece of app knowledge; it ships empty and stays empty for almost everybody.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "BuffTrustDefineRequest",
///  "description": "WHOSE CASTS, BESIDES YOUR OWN, MAY ANCHOR A LANDING (JOS-140). Pushed like every other piece of app knowledge; it ships empty and stays empty for almost everybody.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "buffTrust.define"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/BuffTrustDefineParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct BuffTrustDefineRequest {
    pub id: RequestId,
    pub op: BuffTrustDefineRequestOp,
    pub params: BuffTrustDefineParams,
}
///`BuffTrustDefineRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "buffTrust.define"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum BuffTrustDefineRequestOp {
    #[serde(rename = "buffTrust.define")]
    BuffTrustDefine,
}
impl ::std::fmt::Display for BuffTrustDefineRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::BuffTrustDefine => f.write_str("buffTrust.define"),
        }
    }
}
impl ::std::str::FromStr for BuffTrustDefineRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "buffTrust.define" => Ok(Self::BuffTrustDefine),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for BuffTrustDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for BuffTrustDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for BuffTrustDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`src/shared/buffTrust.ts BuffTrustPrefs`. Typed because it is cheap to type: one list of display spellings, in the order the user added them.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "BuffTrustPrefs",
///  "description": "`src/shared/buffTrust.ts BuffTrustPrefs`. Typed because it is cheap to type: one list of display spellings, in the order the user added them.",
///  "type": "object",
///  "required": [
///    "externals"
///  ],
///  "properties": {
///    "externals": {
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    }
///  },
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct BuffTrustPrefs {
    pub externals: ::std::vec::Vec<::std::string::String>,
}
///A row's fields by name. Open by design — the field set is the VIEW's contract, not the protocol's, so a new column is not a protocol change.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "Cells",
///  "description": "A row's fields by name. Open by design — the field set is the VIEW's contract, not the protocol's, so a new column is not a protocol change.",
///  "type": "object",
///  "additionalProperties": {
///    "$ref": "#/$defs/Cell"
///  }
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct Cells(pub ::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>);
impl ::std::ops::Deref for Cells {
    type Target = ::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>;
    fn deref(&self) -> &::std::collections::BTreeMap<::std::string::String, crate::cell::Cell> {
        &self.0
    }
}
impl ::std::convert::From<Cells>
    for ::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>
{
    fn from(value: Cells) -> Self {
        value.0
    }
}
impl ::std::convert::From<::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>>
    for Cells
{
    fn from(value: ::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>) -> Self {
        Self(value)
    }
}
///Every message the app sends the engine. Internally tagged on `op`, so a new surface is a new branch and the envelope never changes.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ClientMessage",
///  "description": "Every message the app sends the engine. Internally tagged on `op`, so a new surface is a new branch and the envelope never changes.",
///  "oneOf": [
///    {
///      "$ref": "#/$defs/Hello"
///    },
///    {
///      "$ref": "#/$defs/EchoRequest"
///    },
///    {
///      "$ref": "#/$defs/SessionAttachRequest"
///    },
///    {
///      "$ref": "#/$defs/SessionHealthRequest"
///    },
///    {
///      "$ref": "#/$defs/SessionProgressRequest"
///    },
///    {
///      "$ref": "#/$defs/ModuleSnapshotRequest"
///    },
///    {
///      "$ref": "#/$defs/PerfSnapshotRequest"
///    },
///    {
///      "$ref": "#/$defs/ViewSubscribeRequest"
///    },
///    {
///      "$ref": "#/$defs/ViewUnsubscribeRequest"
///    },
///    {
///      "$ref": "#/$defs/AlertsDefineRequest"
///    },
///    {
///      "$ref": "#/$defs/BuffTrustDefineRequest"
///    },
///    {
///      "$ref": "#/$defs/RespawnDefineRequest"
///    },
///    {
///      "$ref": "#/$defs/ComboDefineRequest"
///    },
///    {
///      "$ref": "#/$defs/RosterDefineRequest"
///    },
///    {
///      "$ref": "#/$defs/CombatSnapshotRequest"
///    },
///    {
///      "$ref": "#/$defs/CombatSearchFightsRequest"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum ClientMessage {
    Hello(Hello),
    EchoRequest(EchoRequest),
    SessionAttachRequest(SessionAttachRequest),
    SessionHealthRequest(SessionHealthRequest),
    SessionProgressRequest(SessionProgressRequest),
    ModuleSnapshotRequest(ModuleSnapshotRequest),
    PerfSnapshotRequest(PerfSnapshotRequest),
    ViewSubscribeRequest(ViewSubscribeRequest),
    ViewUnsubscribeRequest(ViewUnsubscribeRequest),
    AlertsDefineRequest(AlertsDefineRequest),
    BuffTrustDefineRequest(BuffTrustDefineRequest),
    RespawnDefineRequest(RespawnDefineRequest),
    ComboDefineRequest(ComboDefineRequest),
    RosterDefineRequest(RosterDefineRequest),
    CombatSnapshotRequest(CombatSnapshotRequest),
    CombatSearchFightsRequest(CombatSearchFightsRequest),
}
impl ::std::convert::From<Hello> for ClientMessage {
    fn from(value: Hello) -> Self {
        Self::Hello(value)
    }
}
impl ::std::convert::From<EchoRequest> for ClientMessage {
    fn from(value: EchoRequest) -> Self {
        Self::EchoRequest(value)
    }
}
impl ::std::convert::From<SessionAttachRequest> for ClientMessage {
    fn from(value: SessionAttachRequest) -> Self {
        Self::SessionAttachRequest(value)
    }
}
impl ::std::convert::From<SessionHealthRequest> for ClientMessage {
    fn from(value: SessionHealthRequest) -> Self {
        Self::SessionHealthRequest(value)
    }
}
impl ::std::convert::From<SessionProgressRequest> for ClientMessage {
    fn from(value: SessionProgressRequest) -> Self {
        Self::SessionProgressRequest(value)
    }
}
impl ::std::convert::From<ModuleSnapshotRequest> for ClientMessage {
    fn from(value: ModuleSnapshotRequest) -> Self {
        Self::ModuleSnapshotRequest(value)
    }
}
impl ::std::convert::From<PerfSnapshotRequest> for ClientMessage {
    fn from(value: PerfSnapshotRequest) -> Self {
        Self::PerfSnapshotRequest(value)
    }
}
impl ::std::convert::From<ViewSubscribeRequest> for ClientMessage {
    fn from(value: ViewSubscribeRequest) -> Self {
        Self::ViewSubscribeRequest(value)
    }
}
impl ::std::convert::From<ViewUnsubscribeRequest> for ClientMessage {
    fn from(value: ViewUnsubscribeRequest) -> Self {
        Self::ViewUnsubscribeRequest(value)
    }
}
impl ::std::convert::From<AlertsDefineRequest> for ClientMessage {
    fn from(value: AlertsDefineRequest) -> Self {
        Self::AlertsDefineRequest(value)
    }
}
impl ::std::convert::From<BuffTrustDefineRequest> for ClientMessage {
    fn from(value: BuffTrustDefineRequest) -> Self {
        Self::BuffTrustDefineRequest(value)
    }
}
impl ::std::convert::From<RespawnDefineRequest> for ClientMessage {
    fn from(value: RespawnDefineRequest) -> Self {
        Self::RespawnDefineRequest(value)
    }
}
impl ::std::convert::From<ComboDefineRequest> for ClientMessage {
    fn from(value: ComboDefineRequest) -> Self {
        Self::ComboDefineRequest(value)
    }
}
impl ::std::convert::From<RosterDefineRequest> for ClientMessage {
    fn from(value: RosterDefineRequest) -> Self {
        Self::RosterDefineRequest(value)
    }
}
impl ::std::convert::From<CombatSnapshotRequest> for ClientMessage {
    fn from(value: CombatSnapshotRequest) -> Self {
        Self::CombatSnapshotRequest(value)
    }
}
impl ::std::convert::From<CombatSearchFightsRequest> for ClientMessage {
    fn from(value: CombatSearchFightsRequest) -> Self {
        Self::CombatSearchFightsRequest(value)
    }
}
///`CombatSearchFightsParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "CombatSearchFightsParams",
///  "type": "object",
///  "required": [
///    "query"
///  ],
///  "properties": {
///    "limit": {
///      "description": "How many ranked hits to return. CLAMPED to the engine's own bounds rather than refused, which is `world.ts`'s rule kept verbatim: a renderer bug asking for an unbounded payload is a payload problem, not a conversation-ending one, and a search box that stopped answering because a number was silly would be the worse failure. Absent takes the engine's default.",
///      "type": "integer"
///    },
///    "query": {
///      "description": "What the user typed. Tokenized to lowercase alphanumerics; an empty or whitespace-only query answers NO hits rather than everything — the UI shows its ordinary browse list in that state, and returning the whole corpus would make the empty box the most expensive keystroke of all.",
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CombatSearchFightsParams {
    ///How many ranked hits to return. CLAMPED to the engine's own bounds rather than refused, which is `world.ts`'s rule kept verbatim: a renderer bug asking for an unbounded payload is a payload problem, not a conversation-ending one, and a search box that stopped answering because a number was silly would be the worse failure. Absent takes the engine's default.
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub limit: ::std::option::Option<i64>,
    ///What the user typed. Tokenized to lowercase alphanumerics; an empty or whitespace-only query answers NO hits rather than everything — the UI shows its ordinary browse list in that state, and returning the whole corpus would make the empty box the most expensive keystroke of all.
    pub query: ::std::string::String,
}
///SEARCH THE FIGHT HISTORY (Task #61, moved server-side by JOS-485). `src/main/ipc/world.ts`'s `searchFights` handler, whose semantics are mirrored here exactly: a non-string query is the empty string, and a `limit` is CLAMPED rather than refused — see `CombatSearchFightsParams.limit`. The corpus is the engine's UNCAPPED encounter history plus the open fight, which is why this is an op and not a view: it is a ranked answer to a question, not a window over a collection, and its rows are the app's own `SegmentSummary` rather than cells.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "CombatSearchFightsRequest",
///  "description": "SEARCH THE FIGHT HISTORY (Task #61, moved server-side by JOS-485). `src/main/ipc/world.ts`'s `searchFights` handler, whose semantics are mirrored here exactly: a non-string query is the empty string, and a `limit` is CLAMPED rather than refused — see `CombatSearchFightsParams.limit`. The corpus is the engine's UNCAPPED encounter history plus the open fight, which is why this is an op and not a view: it is a ranked answer to a question, not a window over a collection, and its rows are the app's own `SegmentSummary` rather than cells.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "combat.searchFights"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/CombatSearchFightsParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CombatSearchFightsRequest {
    pub id: RequestId,
    pub op: CombatSearchFightsRequestOp,
    pub params: CombatSearchFightsParams,
}
///`CombatSearchFightsRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "combat.searchFights"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum CombatSearchFightsRequestOp {
    #[serde(rename = "combat.searchFights")]
    CombatSearchFights,
}
impl ::std::fmt::Display for CombatSearchFightsRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::CombatSearchFights => f.write_str("combat.searchFights"),
        }
    }
}
impl ::std::str::FromStr for CombatSearchFightsRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "combat.searchFights" => Ok(Self::CombatSearchFights),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for CombatSearchFightsRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CombatSearchFightsRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CombatSearchFightsRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`src/shared/combat.ts FightSearchResult`. Ranked hits, best first, ties broken by recency and then by id so the order never depends on the corpus's arrival order.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "CombatSearchFightsResult",
///  "description": "`src/shared/combat.ts FightSearchResult`. Ranked hits, best first, ties broken by recency and then by id so the order never depends on the corpus's arrival order.",
///  "type": "object",
///  "required": [
///    "corpus",
///    "hits"
///  ],
///  "properties": {
///    "corpus": {
///      "description": "How many fights were SEARCHED — the whole uncapped history plus the open fight. It lets a UI say `12 of 1,428` honestly instead of implying the corpus is the result set, and it is present even when `hits` is empty, because `no matches in 1,428` and `nothing to search` are different sentences.",
///      "type": "integer"
///    },
///    "hits": {
///      "description": "The ranked hits, already capped by `limit`.",
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/FightSearchHit"
///      }
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CombatSearchFightsResult {
    ///How many fights were SEARCHED — the whole uncapped history plus the open fight. It lets a UI say `12 of 1,428` honestly instead of implying the corpus is the result set, and it is present even when `hits` is empty, because `no matches in 1,428` and `nothing to search` are different sentences.
    pub corpus: i64,
    ///The ranked hits, already capped by `limit`.
    pub hits: ::std::vec::Vec<FightSearchHit>,
}
///`src/shared/combat.ts SnapshotOpts`, and OPEN rather than closed — the one shape in this schema where an unlisted key is IGNORED instead of refused. An option is a request for MORE work, so an engine that does not know one has already given the honest answer by not doing it; refusing the whole call would turn a client that learned a new option into a client that cannot ask for anything. That is the opposite of `AlertDefinition`'s openness, which exists because a definition ROUND-TRIPS and a dropped field would rewrite the user's data — nothing here comes back, so dropping an unknown key costs a caller nothing it can lose. Every field is absent-means-the-engine's-default; there is deliberately no `combinePets`, which the owner cut in 2026-08-04 and which lives in the renderer now.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "CombatSnapshotOpts",
///  "description": "`src/shared/combat.ts SnapshotOpts`, and OPEN rather than closed — the one shape in this schema where an unlisted key is IGNORED instead of refused. An option is a request for MORE work, so an engine that does not know one has already given the honest answer by not doing it; refusing the whole call would turn a client that learned a new option into a client that cannot ask for anything. That is the opposite of `AlertDefinition`'s openness, which exists because a definition ROUND-TRIPS and a dropped field would rewrite the user's data — nothing here comes back, so dropping an unknown key costs a caller nothing it can lose. Every field is absent-means-the-engine's-default; there is deliberately no `combinePets`, which the owner cut in 2026-08-04 and which lives in the renderer now.",
///  "type": "object",
///  "properties": {
///    "maxSegments": {
///      "description": "Cap on finalized-fight summaries to serialize, newest-first. A PAYLOAD bound, never a retention one: the current encounter and the zone summary are always included, and a selected fight outside the cap still resolves fully through `selected`.",
///      "type": "integer"
///    },
///    "selectedId": {
///      "description": "Which fight or zone session to resolve `selected` against. An id this fold does not carry falls back to the default selection — the open fight, else the most recent finalized one, and NEVER the zone aggregate.",
///      "type": "string"
///    },
///    "showUnparsed": {
///      "description": "Include lines the engine could not classify. Reads the classification ring, which this fold never writes — see `fold/src/combat/state.rs` fact 2 — so it moves nothing here and is carried because the option is the app's and this op is its replacement.",
///      "type": "boolean"
///    },
///    "timeline": {
///      "description": "Include the SELECTED encounter's event timeline. Off by default because the timeline payload is heavier than the bar view.",
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct CombatSnapshotOpts {
    ///Cap on finalized-fight summaries to serialize, newest-first. A PAYLOAD bound, never a retention one: the current encounter and the zone summary are always included, and a selected fight outside the cap still resolves fully through `selected`.
    #[serde(
        rename = "maxSegments",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub max_segments: ::std::option::Option<i64>,
    ///Which fight or zone session to resolve `selected` against. An id this fold does not carry falls back to the default selection — the open fight, else the most recent finalized one, and NEVER the zone aggregate.
    #[serde(
        rename = "selectedId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub selected_id: ::std::option::Option<::std::string::String>,
    ///Include lines the engine could not classify. Reads the classification ring, which this fold never writes — see `fold/src/combat/state.rs` fact 2 — so it moves nothing here and is carried because the option is the app's and this op is its replacement.
    #[serde(
        rename = "showUnparsed",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub show_unparsed: ::std::option::Option<bool>,
    ///Include the SELECTED encounter's event timeline. Off by default because the timeline payload is heavier than the bar view.
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub timeline: ::std::option::Option<bool>,
}
impl ::std::default::Default for CombatSnapshotOpts {
    fn default() -> Self {
        Self {
            max_segments: Default::default(),
            selected_id: Default::default(),
            show_unparsed: Default::default(),
            timeline: Default::default(),
        }
    }
}
///`CombatSnapshotParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "CombatSnapshotParams",
///  "type": "object",
///  "properties": {
///    "opts": {
///      "$ref": "#/$defs/CombatSnapshotOpts"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CombatSnapshotParams {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub opts: ::std::option::Option<CombatSnapshotOpts>,
}
impl ::std::default::Default for CombatSnapshotParams {
    fn default() -> Self {
        Self {
            opts: Default::default(),
        }
    }
}
///THE COMBAT ENGINE, ASKED (JOS-485). The whole of what `combat:snapshot` serves over IPC today — the selection, the segment list, the zone sessions, the stance and poison readouts, the roster and the hydration flag — from the fold that is running, through the same one door `module.snapshot` uses. It is NOT a `module.snapshot`: the combat engine is not in the registry (`WIRING_ORDER` does not name it), it is the post-registry subscriber, and asking for it by a module name would be asking the wrong authority. THE INSTANT IS THE ENGINE'S TO CHOOSE and the reply says which one it chose — see `CombatSnapshotResult.now`.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "CombatSnapshotRequest",
///  "description": "THE COMBAT ENGINE, ASKED (JOS-485). The whole of what `combat:snapshot` serves over IPC today — the selection, the segment list, the zone sessions, the stance and poison readouts, the roster and the hydration flag — from the fold that is running, through the same one door `module.snapshot` uses. It is NOT a `module.snapshot`: the combat engine is not in the registry (`WIRING_ORDER` does not name it), it is the post-registry subscriber, and asking for it by a module name would be asking the wrong authority. THE INSTANT IS THE ENGINE'S TO CHOOSE and the reply says which one it chose — see `CombatSnapshotResult.now`.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "combat.snapshot"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/CombatSnapshotParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CombatSnapshotRequest {
    pub id: RequestId,
    pub op: CombatSnapshotRequestOp,
    pub params: CombatSnapshotParams,
}
///`CombatSnapshotRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "combat.snapshot"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum CombatSnapshotRequestOp {
    #[serde(rename = "combat.snapshot")]
    CombatSnapshot,
}
impl ::std::fmt::Display for CombatSnapshotRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::CombatSnapshot => f.write_str("combat.snapshot"),
        }
    }
}
impl ::std::str::FromStr for CombatSnapshotRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "combat.snapshot" => Ok(Self::CombatSnapshot),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for CombatSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CombatSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CombatSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///The snapshot, and the instant it was taken at. TWO FIELDS RATHER THAN ONE because `now` is not recoverable from the payload and the whole answer is a function of it: a fight closes on elapsed time, `inCombat` is a freshness test, and a summary's `active` flag is the same question per row. A client that could not see which clock the engine used could not tell a stale answer from a quiet log.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "CombatSnapshotResult",
///  "description": "The snapshot, and the instant it was taken at. TWO FIELDS RATHER THAN ONE because `now` is not recoverable from the payload and the whole answer is a function of it: a fight closes on elapsed time, `inCombat` is a freshness test, and a summary's `active` flag is the same question per row. A client that could not see which clock the engine used could not tell a stale answer from a quiet log.",
///  "type": "object",
///  "required": [
///    "now",
///    "snapshot"
///  ],
///  "properties": {
///    "now": {
///      "description": "THE INSTANT THE SNAPSHOT WAS TAKEN AT, in epoch millis, and the engine chose it: the process's own wall clock once the tail is LIVE, and the fold's own `lastTs` — the log's clock — at every moment before that. A REPLAY IS NOT A MOMENT IN TIME (`engine.ts`'s hydrating gate, ported): every line of a months-old log is weeks behind the host clock, so a mid-scan answer stamped `Date.now()` would finalize whatever fight was open and hand the rest of it to a fresh encounter — MEASURED app-side, one 53,577-damage fight splitting into 43,504 + 10,073 under load. It is stated rather than assumed because it is what makes a mid-fold answer a REAL PREFIX STATE: the same bytes asked at the same `seq` give the same snapshot, which is ruling 18 law 1 for this surface.",
///      "type": "integer"
///    },
///    "snapshot": {
///      "$ref": "#/$defs/CombatState"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CombatSnapshotResult {
    ///THE INSTANT THE SNAPSHOT WAS TAKEN AT, in epoch millis, and the engine chose it: the process's own wall clock once the tail is LIVE, and the fold's own `lastTs` — the log's clock — at every moment before that. A REPLAY IS NOT A MOMENT IN TIME (`engine.ts`'s hydrating gate, ported): every line of a months-old log is weeks behind the host clock, so a mid-scan answer stamped `Date.now()` would finalize whatever fight was open and hand the rest of it to a fresh encounter — MEASURED app-side, one 53,577-damage fight splitting into 43,504 + 10,073 under load. It is stated rather than assumed because it is what makes a mid-fold answer a REAL PREFIX STATE: the same bytes asked at the same `seq` give the same snapshot, which is ruling 18 law 1 for this surface.
    pub now: i64,
    pub snapshot: CombatState,
}
///THE COMBAT SNAPSHOT, AND THE PROTOCOL STATES NOTHING ABOUT ITS SHAPE — the `ModuleState` argument, one surface over. `src/shared/combat.ts CombatSnapshot` is ~14 fields of nested view builders (six of them, each with its own row types), it is the app's own contract with its renderer, and a meter growing a column must not be a protocol change or a `badParams` refusal. Typed-where-cheap is emphatically not cheap here: typify would lower every count in it to `f64`, which is the `Cell` defect at the scale of a whole damage meter. It is an OBJECT and always one, which is where it differs from `ModuleState` — the registry publishes both objects and arrays, `CombatEngine::snapshot` publishes an object and nothing else — so this says `object` and lowers to an ordered map of raw JSON in both languages, with every integer intact.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "CombatState",
///  "description": "THE COMBAT SNAPSHOT, AND THE PROTOCOL STATES NOTHING ABOUT ITS SHAPE — the `ModuleState` argument, one surface over. `src/shared/combat.ts CombatSnapshot` is ~14 fields of nested view builders (six of them, each with its own row types), it is the app's own contract with its renderer, and a meter growing a column must not be a protocol change or a `badParams` refusal. Typed-where-cheap is emphatically not cheap here: typify would lower every count in it to `f64`, which is the `Cell` defect at the scale of a whole damage meter. It is an OBJECT and always one, which is where it differs from `ModuleState` — the registry publishes both objects and arrays, `CombatEngine::snapshot` publishes an object and nothing else — so this says `object` and lowers to an ordered map of raw JSON in both languages, with every integer intact.",
///  "type": "object",
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct CombatState(pub ::serde_json::Map<::std::string::String, ::serde_json::Value>);
impl ::std::ops::Deref for CombatState {
    type Target = ::serde_json::Map<::std::string::String, ::serde_json::Value>;
    fn deref(&self) -> &::serde_json::Map<::std::string::String, ::serde_json::Value> {
        &self.0
    }
}
impl ::std::convert::From<CombatState>
    for ::serde_json::Map<::std::string::String, ::serde_json::Value>
{
    fn from(value: CombatState) -> Self {
        value.0
    }
}
impl ::std::convert::From<::serde_json::Map<::std::string::String, ::serde_json::Value>>
    for CombatState
{
    fn from(value: ::serde_json::Map<::std::string::String, ::serde_json::Value>) -> Self {
        Self(value)
    }
}
///`src/shared/classCombo.ts ComboCorrection` — a span the user re-labelled, and when they said so.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ComboCorrection",
///  "description": "`src/shared/classCombo.ts ComboCorrection` — a span the user re-labelled, and when they said so.",
///  "type": "object",
///  "required": [
///    "classes",
///    "endTs",
///    "setAt",
///    "startTs"
///  ],
///  "properties": {
///    "classes": {
///      "description": "One to three class codes, as the `/who` row spells them.",
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "endTs": {
///      "description": "`null` means `from startTs onward`, i.e. it applies to the open interval too. REQUIRED AND NULLABLE rather than optional, because the store's own type says `number | null` and its only writer always writes one of the two — and because an optional nullable is a field that does not survive a round trip: a generator lowers it to `Option`, drops the null on the way back out, and a fixture that carried the store's own shape stops matching itself.",
///      "type": [
///        "integer",
///        "null"
///      ]
///    },
///    "setAt": {
///      "description": "When the user set it — a later correction wins over an earlier overlapping one.",
///      "type": "integer"
///    },
///    "startTs": {
///      "type": "integer"
///    }
///  },
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct ComboCorrection {
    ///One to three class codes, as the `/who` row spells them.
    pub classes: ::std::vec::Vec<::std::string::String>,
    ///`null` means `from startTs onward`, i.e. it applies to the open interval too. REQUIRED AND NULLABLE rather than optional, because the store's own type says `number | null` and its only writer always writes one of the two — and because an optional nullable is a field that does not survive a round trip: a generator lowers it to `Option`, drops the null on the way back out, and a fixture that carried the store's own shape stops matching itself.
    #[serde(rename = "endTs")]
    pub end_ts: ::std::option::Option<i64>,
    ///When the user set it — a later correction wins over an earlier overlapping one.
    #[serde(rename = "setAt")]
    pub set_at: i64,
    #[serde(rename = "startTs")]
    pub start_ts: i64,
}
///`ComboDefineParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ComboDefineParams",
///  "type": "object",
///  "required": [
///    "corrections"
///  ],
///  "properties": {
///    "corrections": {
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/ComboCorrection"
///      }
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ComboDefineParams {
    pub corrections: ::std::vec::Vec<ComboCorrection>,
}
///THE USER'S CLASS-COMBO CORRECTIONS — the one input to the loadout model that the log cannot state. Character-scoped app-side; the engine holds whatever the app last pushed for the character it is folding.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ComboDefineRequest",
///  "description": "THE USER'S CLASS-COMBO CORRECTIONS — the one input to the loadout model that the log cannot state. Character-scoped app-side; the engine holds whatever the app last pushed for the character it is folding.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "combo.define"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/ComboDefineParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ComboDefineRequest {
    pub id: RequestId,
    pub op: ComboDefineRequestOp,
    pub params: ComboDefineParams,
}
///`ComboDefineRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "combo.define"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ComboDefineRequestOp {
    #[serde(rename = "combo.define")]
    ComboDefine,
}
impl ::std::fmt::Display for ComboDefineRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ComboDefine => f.write_str("combo.define"),
        }
    }
}
impl ::std::str::FromStr for ComboDefineRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "combo.define" => Ok(Self::ComboDefine),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ComboDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ComboDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ComboDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///The answer to every `*.define` command, and it is deliberately the SAME shape for all five. A define is an idempotent FULL-SET REPLACE (the cutover ledger's command law: replayable, order-collapsing, hash-friendly for ruling 18's cache key), so there is nothing per-family to report back — the engine either took the set or refused the frame. `count` is how many entries it took, which is the one number a caller can check its own push against; it is absent for a family whose payload is not a list (`buffTrust`, `respawn` push one object each).
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "DefineAck",
///  "description": "The answer to every `*.define` command, and it is deliberately the SAME shape for all five. A define is an idempotent FULL-SET REPLACE (the cutover ledger's command law: replayable, order-collapsing, hash-friendly for ruling 18's cache key), so there is nothing per-family to report back — the engine either took the set or refused the frame. `count` is how many entries it took, which is the one number a caller can check its own push against; it is absent for a family whose payload is not a list (`buffTrust`, `respawn` push one object each).",
///  "type": "object",
///  "required": [
///    "applied"
///  ],
///  "properties": {
///    "applied": {
///      "type": "boolean",
///      "enum": [
///        true
///      ]
///    },
///    "count": {
///      "description": "Entries taken, for a list-shaped payload. Absent means the payload was not a list, NEVER that nothing was taken — an empty list answers `count: 0`, which is how a caller clears a family and can tell it worked.",
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct DefineAck {
    pub applied: bool,
    ///Entries taken, for a list-shaped payload. Absent means the payload was not a list, NEVER that nothing was taken — an empty list answers `count: 0`, which is how a caller clears a family and can tell it worked.
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub count: ::std::option::Option<i64>,
}
///One coalesced batch of changes to the open window. Ops apply IN ORDER. `total` is present only when it moved.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "DiffMessage",
///  "description": "One coalesced batch of changes to the open window. Ops apply IN ORDER. `total` is present only when it moved.",
///  "type": "object",
///  "required": [
///    "epoch",
///    "id",
///    "kind",
///    "ops"
///  ],
///  "properties": {
///    "epoch": {
///      "$ref": "#/$defs/Epoch"
///    },
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "diff"
///      ]
///    },
///    "ops": {
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/DiffOp"
///      }
///    },
///    "total": {
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct DiffMessage {
    pub epoch: Epoch,
    pub id: RequestId,
    pub kind: DiffMessageKind,
    pub ops: ::std::vec::Vec<DiffOp>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub total: ::std::option::Option<i64>,
}
///`DiffMessageKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "diff"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum DiffMessageKind {
    #[serde(rename = "diff")]
    Diff,
}
impl ::std::fmt::Display for DiffMessageKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Diff => f.write_str("diff"),
        }
    }
}
impl ::std::str::FromStr for DiffMessageKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "diff" => Ok(Self::Diff),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for DiffMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for DiffMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for DiffMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`DiffOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "DiffOp",
///  "oneOf": [
///    {
///      "$ref": "#/$defs/InsertOp"
///    },
///    {
///      "$ref": "#/$defs/UpdateOp"
///    },
///    {
///      "$ref": "#/$defs/DropOp"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum DiffOp {
    InsertOp(InsertOp),
    UpdateOp(UpdateOp),
    DropOp(DropOp),
}
impl ::std::convert::From<InsertOp> for DiffOp {
    fn from(value: InsertOp) -> Self {
        Self::InsertOp(value)
    }
}
impl ::std::convert::From<UpdateOp> for DiffOp {
    fn from(value: UpdateOp) -> Self {
        Self::UpdateOp(value)
    }
}
impl ::std::convert::From<DropOp> for DiffOp {
    fn from(value: DropOp) -> Self {
        Self::DropOp(value)
    }
}
///A row left the window. It may still exist in the view — a newest-first window pushes the oldest row out on every insert.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "DropOp",
///  "description": "A row left the window. It may still exist in the view — a newest-first window pushes the oldest row out on every insert.",
///  "type": "object",
///  "required": [
///    "key",
///    "op"
///  ],
///  "properties": {
///    "key": {
///      "$ref": "#/$defs/RowKey"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "drop"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct DropOp {
    pub key: RowKey,
    pub op: DropOpOp,
}
///`DropOpOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "drop"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum DropOpOp {
    #[serde(rename = "drop")]
    Drop,
}
impl ::std::fmt::Display for DropOpOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Drop => f.write_str("drop"),
        }
    }
}
impl ::std::str::FromStr for DropOpOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "drop" => Ok(Self::Drop),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for DropOpOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for DropOpOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for DropOpOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`EchoParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "EchoParams",
///  "type": "object",
///  "required": [
///    "text"
///  ],
///  "properties": {
///    "text": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct EchoParams {
    pub text: ::std::string::String,
}
///The skeleton's own op: it proves a whole message travelled the seam and came back, with no game logic anywhere.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "EchoRequest",
///  "description": "The skeleton's own op: it proves a whole message travelled the seam and came back, with no game logic anywhere.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "echo"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/EchoParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct EchoRequest {
    pub id: RequestId,
    pub op: EchoRequestOp,
    pub params: EchoParams,
}
///`EchoRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "echo"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum EchoRequestOp {
    #[serde(rename = "echo")]
    Echo,
}
impl ::std::fmt::Display for EchoRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Echo => f.write_str("echo"),
        }
    }
}
impl ::std::str::FromStr for EchoRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "echo" => Ok(Self::Echo),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for EchoRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for EchoRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EchoRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`EchoResult`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "EchoResult",
///  "type": "object",
///  "required": [
///    "text"
///  ],
///  "properties": {
///    "text": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct EchoResult {
    pub text: ::std::string::String,
}
///Every message the engine sends the app. Internally tagged on `kind`.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "EngineMessage",
///  "description": "Every message the engine sends the app. Internally tagged on `kind`.",
///  "oneOf": [
///    {
///      "$ref": "#/$defs/HelloReply"
///    },
///    {
///      "$ref": "#/$defs/Reply"
///    },
///    {
///      "$ref": "#/$defs/ErrorReply"
///    },
///    {
///      "$ref": "#/$defs/ResetMessage"
///    },
///    {
///      "$ref": "#/$defs/DiffMessage"
///    },
///    {
///      "$ref": "#/$defs/EpochMessage"
///    },
///    {
///      "$ref": "#/$defs/FireMessage"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum EngineMessage {
    HelloReply(HelloReply),
    Reply(Reply),
    ErrorReply(ErrorReply),
    ResetMessage(ResetMessage),
    DiffMessage(DiffMessage),
    EpochMessage(EpochMessage),
    FireMessage(FireMessage),
}
impl ::std::convert::From<HelloReply> for EngineMessage {
    fn from(value: HelloReply) -> Self {
        Self::HelloReply(value)
    }
}
impl ::std::convert::From<Reply> for EngineMessage {
    fn from(value: Reply) -> Self {
        Self::Reply(value)
    }
}
impl ::std::convert::From<ErrorReply> for EngineMessage {
    fn from(value: ErrorReply) -> Self {
        Self::ErrorReply(value)
    }
}
impl ::std::convert::From<ResetMessage> for EngineMessage {
    fn from(value: ResetMessage) -> Self {
        Self::ResetMessage(value)
    }
}
impl ::std::convert::From<DiffMessage> for EngineMessage {
    fn from(value: DiffMessage) -> Self {
        Self::DiffMessage(value)
    }
}
impl ::std::convert::From<EpochMessage> for EngineMessage {
    fn from(value: EpochMessage) -> Self {
        Self::EpochMessage(value)
    }
}
impl ::std::convert::From<FireMessage> for EngineMessage {
    fn from(value: FireMessage) -> Self {
        Self::FireMessage(value)
    }
}
///The world's generation. Monotonic within one engine process. A client that sees an epoch it did not expect DROPS ALL STATE and waits for the reset — it never reconciles across a bump.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "Epoch",
///  "description": "The world's generation. Monotonic within one engine process. A client that sees an epoch it did not expect DROPS ALL STATE and waits for the reset — it never reconciles across a bump.",
///  "type": "integer"
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct Epoch(pub i64);
impl ::std::ops::Deref for Epoch {
    type Target = i64;
    fn deref(&self) -> &i64 {
        &self.0
    }
}
impl ::std::convert::From<Epoch> for i64 {
    fn from(value: Epoch) -> Self {
        value.0
    }
}
impl ::std::convert::From<i64> for Epoch {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl ::std::str::FromStr for Epoch {
    type Err = <i64 as ::std::str::FromStr>::Err;
    fn from_str(value: &str) -> ::std::result::Result<Self, Self::Err> {
        Ok(Self(value.parse()?))
    }
}
impl ::std::convert::TryFrom<&str> for Epoch {
    type Error = <i64 as ::std::str::FromStr>::Err;
    fn try_from(value: &str) -> ::std::result::Result<Self, Self::Error> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<String> for Epoch {
    type Error = <i64 as ::std::str::FromStr>::Err;
    fn try_from(value: String) -> ::std::result::Result<Self, Self::Error> {
        value.parse()
    }
}
impl ::std::fmt::Display for Epoch {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        self.0.fmt(f)
    }
}
///CONNECTION-WIDE, and therefore the one stream message with no `id`: the world's generation belongs to the connection, not to any subscription. It announces a bump (`attach`, `restart`) or reports fold progress within the current generation (`progress`, which never changes `epoch`). After a bump every open subscription receives its own fresh reset when the fold lands.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "EpochMessage",
///  "description": "CONNECTION-WIDE, and therefore the one stream message with no `id`: the world's generation belongs to the connection, not to any subscription. It announces a bump (`attach`, `restart`) or reports fold progress within the current generation (`progress`, which never changes `epoch`). After a bump every open subscription receives its own fresh reset when the fold lands.",
///  "type": "object",
///  "required": [
///    "epoch",
///    "kind",
///    "reason"
///  ],
///  "properties": {
///    "epoch": {
///      "$ref": "#/$defs/Epoch"
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "epoch"
///      ]
///    },
///    "progress": {
///      "$ref": "#/$defs/FoldProgress"
///    },
///    "reason": {
///      "$ref": "#/$defs/EpochReason"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct EpochMessage {
    pub epoch: Epoch,
    pub kind: EpochMessageKind,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub progress: ::std::option::Option<FoldProgress>,
    pub reason: EpochReason,
}
///`EpochMessageKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "epoch"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum EpochMessageKind {
    #[serde(rename = "epoch")]
    Epoch,
}
impl ::std::fmt::Display for EpochMessageKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Epoch => f.write_str("epoch"),
        }
    }
}
impl ::std::str::FromStr for EpochMessageKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "epoch" => Ok(Self::Epoch),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for EpochMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for EpochMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EpochMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`EpochReason`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "EpochReason",
///  "type": "string",
///  "enum": [
///    "attach",
///    "restart",
///    "progress"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum EpochReason {
    #[serde(rename = "attach")]
    Attach,
    #[serde(rename = "restart")]
    Restart,
    #[serde(rename = "progress")]
    Progress,
}
impl ::std::fmt::Display for EpochReason {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Attach => f.write_str("attach"),
            Self::Restart => f.write_str("restart"),
            Self::Progress => f.write_str("progress"),
        }
    }
}
impl ::std::str::FromStr for EpochReason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "attach" => Ok(Self::Attach),
            "restart" => Ok(Self::Restart),
            "progress" => Ok(Self::Progress),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for EpochReason {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for EpochReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EpochReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///A CLOSED set. Both sides generate from this artifact, so adding a member is a schema edit that regenerates both — there is no version of the app that can meet a code it has never heard of.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ErrorCode",
///  "description": "A CLOSED set. Both sides generate from this artifact, so adding a member is a schema edit that regenerates both — there is no version of the app that can meet a code it has never heard of.",
///  "type": "string",
///  "enum": [
///    "protocolMismatch",
///    "unauthorized",
///    "unknownOp",
///    "badParams",
///    "notFound",
///    "unavailable",
///    "internal"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ErrorCode {
    #[serde(rename = "protocolMismatch")]
    ProtocolMismatch,
    #[serde(rename = "unauthorized")]
    Unauthorized,
    #[serde(rename = "unknownOp")]
    UnknownOp,
    #[serde(rename = "badParams")]
    BadParams,
    #[serde(rename = "notFound")]
    NotFound,
    #[serde(rename = "unavailable")]
    Unavailable,
    #[serde(rename = "internal")]
    Internal,
}
impl ::std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ProtocolMismatch => f.write_str("protocolMismatch"),
            Self::Unauthorized => f.write_str("unauthorized"),
            Self::UnknownOp => f.write_str("unknownOp"),
            Self::BadParams => f.write_str("badParams"),
            Self::NotFound => f.write_str("notFound"),
            Self::Unavailable => f.write_str("unavailable"),
            Self::Internal => f.write_str("internal"),
        }
    }
}
impl ::std::str::FromStr for ErrorCode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "protocolMismatch" => Ok(Self::ProtocolMismatch),
            "unauthorized" => Ok(Self::Unauthorized),
            "unknownOp" => Ok(Self::UnknownOp),
            "badParams" => Ok(Self::BadParams),
            "notFound" => Ok(Self::NotFound),
            "unavailable" => Ok(Self::Unavailable),
            "internal" => Ok(Self::Internal),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ErrorCode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ErrorCode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ErrorCode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///A refused request. An error is always a reply to a request id — a failure with no request behind it closes the connection instead.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ErrorReply",
///  "description": "A refused request. An error is always a reply to a request id — a failure with no request behind it closes the connection instead.",
///  "type": "object",
///  "required": [
///    "error",
///    "id",
///    "kind",
///    "ok"
///  ],
///  "properties": {
///    "error": {
///      "$ref": "#/$defs/ProtocolError"
///    },
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "error"
///      ]
///    },
///    "ok": {
///      "type": "boolean",
///      "enum": [
///        false
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ErrorReply {
    pub error: ProtocolError,
    pub id: RequestId,
    pub kind: ErrorReplyKind,
    pub ok: bool,
}
///`ErrorReplyKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "error"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ErrorReplyKind {
    #[serde(rename = "error")]
    Error,
}
impl ::std::fmt::Display for ErrorReplyKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Error => f.write_str("error"),
        }
    }
}
impl ::std::str::FromStr for ErrorReplyKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "error" => Ok(Self::Error),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ErrorReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ErrorReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ErrorReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`FightSearchHit`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "FightSearchHit",
///  "type": "object",
///  "required": [
///    "score",
///    "summary"
///  ],
///  "properties": {
///    "score": {
///      "description": "0..1 relevance. Exact token matches outrank prefix, prefix substring, substring a bounded typo correction. A FLOAT and deliberately not a percentage: it is a ranking key the UI may show as a bar, and rounding it here would flatten ties the sort has already broken.",
///      "type": "number"
///    },
///    "summary": {
///      "$ref": "#/$defs/FightSummary"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct FightSearchHit {
    ///0..1 relevance. Exact token matches outrank prefix, prefix substring, substring a bounded typo correction. A FLOAT and deliberately not a percentage: it is a ranking key the UI may show as a bar, and rounding it here would flatten ties the sort has already broken.
    pub score: f64,
    pub summary: FightSummary,
}
///One fight, EXACTLY AS THE ENGINE SUMMARIZES IT — `src/shared/combat.ts SegmentSummary`. Open for `CombatState`'s reason and read off the same builder, so a hit and the same fight inside a snapshot are byte-identical rather than two renderings of one row.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "FightSummary",
///  "description": "One fight, EXACTLY AS THE ENGINE SUMMARIZES IT — `src/shared/combat.ts SegmentSummary`. Open for `CombatState`'s reason and read off the same builder, so a hit and the same fight inside a snapshot are byte-identical rather than two renderings of one row.",
///  "type": "object",
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct FightSummary(pub ::serde_json::Map<::std::string::String, ::serde_json::Value>);
impl ::std::ops::Deref for FightSummary {
    type Target = ::serde_json::Map<::std::string::String, ::serde_json::Value>;
    fn deref(&self) -> &::serde_json::Map<::std::string::String, ::serde_json::Value> {
        &self.0
    }
}
impl ::std::convert::From<FightSummary>
    for ::serde_json::Map<::std::string::String, ::serde_json::Value>
{
    fn from(value: FightSummary) -> Self {
        value.0
    }
}
impl ::std::convert::From<::serde_json::Map<::std::string::String, ::serde_json::Value>>
    for FightSummary
{
    fn from(value: ::serde_json::Map<::std::string::String, ::serde_json::Value>) -> Self {
        Self(value)
    }
}
///AN ALERT FIRED (owner ruling 22). The engine evaluates the user's alert definitions against LIVE events — replay must never make a sound, which is the same boundary law the app-side evaluator has always obeyed — and this is what it says when one matches. CONNECTION-WIDE, and therefore carrying NO `id`: a fire belongs to the world rather than to any subscription, which is the `EpochMessage` precedent. It carries no `epoch` either, and that is the difference from an epoch message rather than an oversight: every other stream frame describes WINDOW STATE a client has to reconcile across a generation, while a fire is a thing that happened once — there is nothing to drop and nothing to re-request, so a generation number would be a field with no reader. IT IS FULLY RESOLVED SERVER-SIDE (the conCard principle): everything the app needs in order to make the identical noise is in these four fields, so no client ever has to hold the definition the fire came from.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "FireMessage",
///  "description": "AN ALERT FIRED (owner ruling 22). The engine evaluates the user's alert definitions against LIVE events — replay must never make a sound, which is the same boundary law the app-side evaluator has always obeyed — and this is what it says when one matches. CONNECTION-WIDE, and therefore carrying NO `id`: a fire belongs to the world rather than to any subscription, which is the `EpochMessage` precedent. It carries no `epoch` either, and that is the difference from an epoch message rather than an oversight: every other stream frame describes WINDOW STATE a client has to reconcile across a generation, while a fire is a thing that happened once — there is nothing to drop and nothing to re-request, so a generation number would be a field with no reader. IT IS FULLY RESOLVED SERVER-SIDE (the conCard principle): everything the app needs in order to make the identical noise is in these four fields, so no client ever has to hold the definition the fire came from.",
///  "type": "object",
///  "required": [
///    "at",
///    "kind",
///    "message",
///    "rule",
///    "sound"
///  ],
///  "properties": {
///    "at": {
///      "description": "When it fired, on THE LOG'S OWN CLOCK — the `ts` of the event that matched, never the host's wall clock. A fire is a statement about the log (ruling 18 law 1).",
///      "type": "integer"
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "fire"
///      ]
///    },
///    "message": {
///      "description": "THE TEXT THAT MATCHED — the log line the trigger fired on, which is what `FiredAlert.matchedText` has always carried and what the event log prints beside the alert's name.",
///      "type": "string"
///    },
///    "rule": {
///      "description": "The alert's LABEL — `AlertDefinition.name`. What fired, in the words the user gave it, so a log line or a banner needs nothing else to be readable.",
///      "type": "string"
///    },
///    "sound": {
///      "description": "THE KEY THE APP WOULD PLAY: `<packId>/<soundId>`, joined from the definition's `sound` reference, which is exactly how the renderer's sound cache is keyed. Resolved here rather than sent as a reference for the conCard reason — an app that had to look the definition back up to know what to play would be holding a second copy of the rule set, which is the coupling this boundary exists to delete.",
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct FireMessage {
    ///When it fired, on THE LOG'S OWN CLOCK — the `ts` of the event that matched, never the host's wall clock. A fire is a statement about the log (ruling 18 law 1).
    pub at: i64,
    pub kind: FireMessageKind,
    ///THE TEXT THAT MATCHED — the log line the trigger fired on, which is what `FiredAlert.matchedText` has always carried and what the event log prints beside the alert's name.
    pub message: ::std::string::String,
    ///The alert's LABEL — `AlertDefinition.name`. What fired, in the words the user gave it, so a log line or a banner needs nothing else to be readable.
    pub rule: ::std::string::String,
    ///THE KEY THE APP WOULD PLAY: `<packId>/<soundId>`, joined from the definition's `sound` reference, which is exactly how the renderer's sound cache is keyed. Resolved here rather than sent as a reference for the conCard reason — an app that had to look the definition back up to know what to play would be holding a second copy of the rule set, which is the coupling this boundary exists to delete.
    pub sound: ::std::string::String,
}
///`FireMessageKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "fire"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum FireMessageKind {
    #[serde(rename = "fire")]
    Fire,
}
impl ::std::fmt::Display for FireMessageKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Fire => f.write_str("fire"),
        }
    }
}
impl ::std::str::FromStr for FireMessageKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "fire" => Ok(Self::Fire),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for FireMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for FireMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for FireMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///What the loading UI reads. Present while a fold is running and on the bump that starts one.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "FoldProgress",
///  "description": "What the loading UI reads. Present while a fold is running and on the bump that starts one.",
///  "type": "object",
///  "required": [
///    "events",
///    "pct"
///  ],
///  "properties": {
///    "events": {
///      "type": "integer"
///    },
///    "pct": {
///      "description": "How far the fold has got, 0 to 100, FRACTIONAL. The engine emits the number it actually measured and does not pre-round it: rounding is a display decision and belongs to whoever is drawing the bar. That is not in tension with the renderer-never-munges rule - that rule is about DOMAIN data (no client-side filtering, sorting or aggregation of the world), and formatting a progress readout for the pixel it lands on is not domain work. A NOTE FOR WORKED EXAMPLES: Rust serializes an f64 whole value as X.0, so a fixture carrying `62` would come back `62.0` and stop being byte-verbatim across the two languages. Examples therefore use a genuinely fractional value (62.4), which round-trips identically in both.",
///      "type": "number"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct FoldProgress {
    pub events: i64,
    ///How far the fold has got, 0 to 100, FRACTIONAL. The engine emits the number it actually measured and does not pre-round it: rounding is a display decision and belongs to whoever is drawing the bar. That is not in tension with the renderer-never-munges rule - that rule is about DOMAIN data (no client-side filtering, sorting or aggregation of the world), and formatting a progress readout for the pixel it lands on is not domain work. A NOTE FOR WORKED EXAMPLES: Rust serializes an f64 whole value as X.0, so a fixture carrying `62` would come back `62.0` and stop being byte-verbatim across the two languages. Examples therefore use a genuinely fractional value (62.4), which round-trips identically in both.
    pub pct: f64,
}
///What the engine's ingest is doing, and where it has got to. THE LAST FOUR FIELDS ARE OPTIONAL AND THAT IS NOT A CONVENIENCE: a health answer given before any attach honestly has no mark, no event count, no log timestamp and no file to stat, and a zero would be a measurement nobody took. Absent means `this engine has not folded anything`; present means the numbers are the fold's own.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "HealthResult",
///  "description": "What the engine's ingest is doing, and where it has got to. THE LAST FOUR FIELDS ARE OPTIONAL AND THAT IS NOT A CONVENIENCE: a health answer given before any attach honestly has no mark, no event count, no log timestamp and no file to stat, and a zero would be a measurement nobody took. Absent means `this engine has not folded anything`; present means the numbers are the fold's own.",
///  "type": "object",
///  "required": [
///    "epoch",
///    "status",
///    "uptimeMs"
///  ],
///  "properties": {
///    "epoch": {
///      "$ref": "#/$defs/Epoch"
///    },
///    "events": {
///      "description": "Events folded in this generation. Counts EVENTS, not lines — a log line the parser declines is not one.",
///      "type": "integer"
///    },
///    "lastEventTs": {
///      "description": "The `ts` of the last event folded — THE LOG'S OWN CLOCK, never the host's. Absent when nothing folded, or when no event so far carried a stamp the parser could read.",
///      "type": "integer"
///    },
///    "logMtimeMs": {
///      "description": "THE LOG FILE'S LAST-MODIFIED TIME, in epoch milliseconds, as the engine stats it (owner ruling 21: the server owns log-file facts — `the server should be the one reading the log file, rather than the app reaching in… reported so the app can use it to display and choose the correct character on launch`). A FILESYSTEM FACT, NOT A FOLD FACT, and the distinction is ruling 18's: it never enters fold state, it is not addressed by (log identity, byte offset), and it is re-stated fresh on every health answer rather than remembered — a remembered mtime is a cache of something the filesystem already holds. Absent before any attach (no file to stat), and absent when the stat fails, which is honest: a log that was renamed out from under the engine has no answer, and 0 would claim 1970. Truncated to whole milliseconds, so it equals `Math.floor(statSync(log).mtimeMs)`.",
///      "type": "integer"
///    },
///    "mark": {
///      "$ref": "#/$defs/LogMark"
///    },
///    "status": {
///      "type": "string",
///      "enum": [
///        "starting",
///        "attaching",
///        "folding",
///        "live",
///        "idle"
///      ]
///    },
///    "uptimeMs": {
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct HealthResult {
    pub epoch: Epoch,
    ///Events folded in this generation. Counts EVENTS, not lines — a log line the parser declines is not one.
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub events: ::std::option::Option<i64>,
    ///The `ts` of the last event folded — THE LOG'S OWN CLOCK, never the host's. Absent when nothing folded, or when no event so far carried a stamp the parser could read.
    #[serde(
        rename = "lastEventTs",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub last_event_ts: ::std::option::Option<i64>,
    ///THE LOG FILE'S LAST-MODIFIED TIME, in epoch milliseconds, as the engine stats it (owner ruling 21: the server owns log-file facts — `the server should be the one reading the log file, rather than the app reaching in… reported so the app can use it to display and choose the correct character on launch`). A FILESYSTEM FACT, NOT A FOLD FACT, and the distinction is ruling 18's: it never enters fold state, it is not addressed by (log identity, byte offset), and it is re-stated fresh on every health answer rather than remembered — a remembered mtime is a cache of something the filesystem already holds. Absent before any attach (no file to stat), and absent when the stat fails, which is honest: a log that was renamed out from under the engine has no answer, and 0 would claim 1970. Truncated to whole milliseconds, so it equals `Math.floor(statSync(log).mtimeMs)`.
    #[serde(
        rename = "logMtimeMs",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub log_mtime_ms: ::std::option::Option<i64>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub mark: ::std::option::Option<LogMark>,
    pub status: HealthResultStatus,
    #[serde(rename = "uptimeMs")]
    pub uptime_ms: i64,
}
///`HealthResultStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "starting",
///    "attaching",
///    "folding",
///    "live",
///    "idle"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum HealthResultStatus {
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "attaching")]
    Attaching,
    #[serde(rename = "folding")]
    Folding,
    #[serde(rename = "live")]
    Live,
    #[serde(rename = "idle")]
    Idle,
}
impl ::std::fmt::Display for HealthResultStatus {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Starting => f.write_str("starting"),
            Self::Attaching => f.write_str("attaching"),
            Self::Folding => f.write_str("folding"),
            Self::Live => f.write_str("live"),
            Self::Idle => f.write_str("idle"),
        }
    }
}
impl ::std::str::FromStr for HealthResultStatus {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "starting" => Ok(Self::Starting),
            "attaching" => Ok(Self::Attaching),
            "folding" => Ok(Self::Folding),
            "live" => Ok(Self::Live),
            "idle" => Ok(Self::Idle),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for HealthResultStatus {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for HealthResultStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for HealthResultStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///The FIRST message on a connection, always. The engine answers with HelloReply or closes the connection; nothing else may precede it.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "Hello",
///  "description": "The FIRST message on a connection, always. The engine answers with HelloReply or closes the connection; nothing else may precede it.",
///  "type": "object",
///  "required": [
///    "op",
///    "protocolVersion",
///    "token"
///  ],
///  "properties": {
///    "op": {
///      "type": "string",
///      "enum": [
///        "hello"
///      ]
///    },
///    "protocolVersion": {
///      "description": "The version the CLIENT was generated against. A mismatch is fatal by ruling: both sides log and the connection closes. Version skew is a build error, not a runtime state to recover from.",
///      "type": "integer"
///    },
///    "token": {
///      "$ref": "#/$defs/Token"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Hello {
    pub op: HelloOp,
    ///The version the CLIENT was generated against. A mismatch is fatal by ruling: both sides log and the connection closes. Version skew is a build error, not a runtime state to recover from.
    #[serde(rename = "protocolVersion")]
    pub protocol_version: i64,
    pub token: Token,
}
///`HelloOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "hello"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum HelloOp {
    #[serde(rename = "hello")]
    Hello,
}
impl ::std::fmt::Display for HelloOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Hello => f.write_str("hello"),
        }
    }
}
impl ::std::str::FromStr for HelloOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "hello" => Ok(Self::Hello),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for HelloOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for HelloOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for HelloOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///The handshake answer. `ok: false` is a courtesy sent immediately before the engine closes the connection — a client must treat a closed connection with no reply as the same outcome.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "HelloReply",
///  "description": "The handshake answer. `ok: false` is a courtesy sent immediately before the engine closes the connection — a client must treat a closed connection with no reply as the same outcome.",
///  "type": "object",
///  "required": [
///    "engineVersion",
///    "kind",
///    "ok",
///    "protocolVersion"
///  ],
///  "properties": {
///    "engineVersion": {
///      "description": "The engine binary's own version (informational; it is NOT the compatibility check).",
///      "type": "string"
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "hello"
///      ]
///    },
///    "ok": {
///      "type": "boolean"
///    },
///    "protocolVersion": {
///      "description": "The version the ENGINE was generated against.",
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct HelloReply {
    ///The engine binary's own version (informational; it is NOT the compatibility check).
    #[serde(rename = "engineVersion")]
    pub engine_version: ::std::string::String,
    pub kind: HelloReplyKind,
    pub ok: bool,
    ///The version the ENGINE was generated against.
    #[serde(rename = "protocolVersion")]
    pub protocol_version: i64,
}
///`HelloReplyKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "hello"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum HelloReplyKind {
    #[serde(rename = "hello")]
    Hello,
}
impl ::std::fmt::Display for HelloReplyKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Hello => f.write_str("hello"),
        }
    }
}
impl ::std::str::FromStr for HelloReplyKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "hello" => Ok(Self::Hello),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for HelloReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for HelloReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for HelloReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///A row entered the window. EXACTLY ONE of `before`/`after` is present and names an anchor row already in the window; neither present means the window was empty. That constraint is not expressible here without an if/then the Rust generator cannot read, so it is enforced in code and pinned by test.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "InsertOp",
///  "description": "A row entered the window. EXACTLY ONE of `before`/`after` is present and names an anchor row already in the window; neither present means the window was empty. That constraint is not expressible here without an if/then the Rust generator cannot read, so it is enforced in code and pinned by test.",
///  "type": "object",
///  "required": [
///    "op",
///    "row"
///  ],
///  "properties": {
///    "after": {
///      "$ref": "#/$defs/RowKey"
///    },
///    "before": {
///      "$ref": "#/$defs/RowKey"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "insert"
///      ]
///    },
///    "row": {
///      "$ref": "#/$defs/Row"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct InsertOp {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub after: ::std::option::Option<RowKey>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub before: ::std::option::Option<RowKey>,
    pub op: InsertOpOp,
    pub row: Row,
}
///`InsertOpOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "insert"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum InsertOpOp {
    #[serde(rename = "insert")]
    Insert,
}
impl ::std::fmt::Display for InsertOpOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Insert => f.write_str("insert"),
        }
    }
}
impl ::std::str::FromStr for InsertOpOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "insert" => Ok(Self::Insert),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for InsertOpOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for InsertOpOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for InsertOpOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///THE ADDRESSABLE COORDINATE (owner ruling 18 law 3): state is addressed by (log identity, byte offset) and by nothing else — never by wall time, never by `current`. `offset` is the end of the last COMPLETE line folded, which is the same definition as the scan's end offset; a half-written line is not an event and the mark waits with it. THIS IS NOT A FRAMING CONCERN: it is a coordinate INSIDE the file the engine reads, and it would mean the same thing over any transport.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "LogMark",
///  "description": "THE ADDRESSABLE COORDINATE (owner ruling 18 law 3): state is addressed by (log identity, byte offset) and by nothing else — never by wall time, never by `current`. `offset` is the end of the last COMPLETE line folded, which is the same definition as the scan's end offset; a half-written line is not an event and the mark waits with it. THIS IS NOT A FRAMING CONCERN: it is a coordinate INSIDE the file the engine reads, and it would mean the same thing over any transport.",
///  "type": "object",
///  "required": [
///    "log",
///    "offset"
///  ],
///  "properties": {
///    "log": {
///      "description": "The log being folded, as the path the app handed the engine at attach. The engine never discovers a path of its own.",
///      "type": "string"
///    },
///    "offset": {
///      "description": "The end of the last complete line folded, counted from the start of the file.",
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct LogMark {
    ///The log being folded, as the path the app handed the engine at attach. The engine never discovers a path of its own.
    pub log: ::std::string::String,
    ///The end of the last complete line folded, counted from the start of the file.
    pub offset: i64,
}
///`ModuleSnapshotParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ModuleSnapshotParams",
///  "type": "object",
///  "required": [
///    "module"
///  ],
///  "properties": {
///    "module": {
///      "description": "The module's id, exactly as the registry spells it — `loot`, `kills`, `buffTimers`. Not a view source: a view is filtered, sorted and windowed, and this is the module's whole state.",
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModuleSnapshotParams {
    ///The module's id, exactly as the registry spells it — `loot`, `kills`, `buffTimers`. Not a view source: a view is filtered, sorted and windowed, and this is the module's whole state.
    pub module: ::std::string::String,
}
///THE FIRST DATA-BEARING OP. Asks the live fold for one module's published state — the same `{ seq, state }` the app's own module registry hydrates from today. The answer is a point-in-time read of the ingest's fold: mid-scan it is a real PREFIX state (every event up to `seq` and no part of another), because the fold answers between its own read boundaries and never inside one. An unknown module name is `notFound`: the registry is the authority on what a module is, and an empty state would be a lie about a module that does not exist.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ModuleSnapshotRequest",
///  "description": "THE FIRST DATA-BEARING OP. Asks the live fold for one module's published state — the same `{ seq, state }` the app's own module registry hydrates from today. The answer is a point-in-time read of the ingest's fold: mid-scan it is a real PREFIX state (every event up to `seq` and no part of another), because the fold answers between its own read boundaries and never inside one. An unknown module name is `notFound`: the registry is the authority on what a module is, and an empty state would be a lie about a module that does not exist.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "module.snapshot"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/ModuleSnapshotParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModuleSnapshotRequest {
    pub id: RequestId,
    pub op: ModuleSnapshotRequestOp,
    pub params: ModuleSnapshotParams,
}
///`ModuleSnapshotRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "module.snapshot"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ModuleSnapshotRequestOp {
    #[serde(rename = "module.snapshot")]
    ModuleSnapshot,
}
impl ::std::fmt::Display for ModuleSnapshotRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ModuleSnapshot => f.write_str("module.snapshot"),
        }
    }
}
impl ::std::str::FromStr for ModuleSnapshotRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "module.snapshot" => Ok(Self::ModuleSnapshot),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ModuleSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ModuleSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ModuleSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ModuleSnapshotResult`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ModuleSnapshotResult",
///  "type": "object",
///  "required": [
///    "module",
///    "seq",
///    "state"
///  ],
///  "properties": {
///    "module": {
///      "description": "The module that answered, echoed back so a caller holding several in flight needs no bookkeeping of its own.",
///      "type": "string"
///    },
///    "seq": {
///      "description": "The module's OWN published seq — for most modules the seq of the last event it folded, and for the four that publish a private revision counter (combo, character, respawn, buffTimers) that counter. It is a hydration cursor, not the fold's event count; `HealthResult.events` is the count.",
///      "type": "integer"
///    },
///    "state": {
///      "$ref": "#/$defs/ModuleState"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModuleSnapshotResult {
    ///The module that answered, echoed back so a caller holding several in flight needs no bookkeeping of its own.
    pub module: ::std::string::String,
    ///The module's OWN published seq — for most modules the seq of the last event it folded, and for the four that publish a private revision counter (combo, character, respawn, buffTimers) that counter. It is a hydration cursor, not the fold's event count; `HealthResult.events` is the count.
    pub seq: i64,
    pub state: ::serde_json::Value,
}
///An op that takes nothing still sends `params: {}`. The envelope keeps one shape, so adding a parameter later is a schema edit rather than an envelope change.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "NoParams",
///  "description": "An op that takes nothing still sends `params: {}`. The envelope keeps one shape, so adding a parameter later is a schema edit rather than an envelope change.",
///  "type": "object",
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct NoParams {}
impl ::std::default::Default for NoParams {
    fn default() -> Self {
        Self {}
    }
}
///WHAT STARTING THIS GENERATION COST. Every field is optional and absent means NOT YET MEASURED rather than zero: `scanMs` is unknown until the scan finishes, and a zero there would say a whole log folded instantly. The engine prints the same two numbers to stderr; this is the same measurement on the wire, so a panel does not have to scrape a log.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "PerfIngest",
///  "description": "WHAT STARTING THIS GENERATION COST. Every field is optional and absent means NOT YET MEASURED rather than zero: `scanMs` is unknown until the scan finishes, and a zero there would say a whole log folded instantly. The engine prints the same two numbers to stderr; this is the same measurement on the wire, so a panel does not have to scrape a log.",
///  "type": "object",
///  "properties": {
///    "scanBytes": {
///      "description": "Bytes read by the scan, up to the mark it landed on. Absent while the scan is still running.",
///      "type": "integer"
///    },
///    "scanMs": {
///      "description": "Wall time from the first byte read to the fold landing. Absent while the scan is still running.",
///      "type": "integer"
///    },
///    "spellDbMs": {
///      "description": "How long the parser's spell catalog took to become available for this attach. Near zero after the first attach of a process — the catalog is built once per process — and the number is reported rather than assumed.",
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct PerfIngest {
    ///Bytes read by the scan, up to the mark it landed on. Absent while the scan is still running.
    #[serde(
        rename = "scanBytes",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub scan_bytes: ::std::option::Option<i64>,
    ///Wall time from the first byte read to the fold landing. Absent while the scan is still running.
    #[serde(
        rename = "scanMs",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub scan_ms: ::std::option::Option<i64>,
    ///How long the parser's spell catalog took to become available for this attach. Near zero after the first attach of a process — the catalog is built once per process — and the number is reported rather than assumed.
    #[serde(
        rename = "spellDbMs",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub spell_db_ms: ::std::option::Option<i64>,
}
impl ::std::default::Default for PerfIngest {
    fn default() -> Self {
        Self {
            scan_bytes: Default::default(),
            scan_ms: Default::default(),
            spell_db_ms: Default::default(),
        }
    }
}
///ONE SOURCE'S SERVE PATH, cumulative for this generation — the counters `views::meter` keeps, exactly as ruling 19 names them. QUEUE TIME IS NEVER COUNTED AS COMPUTE: `foldToFrameUs*` is measured from the instant the fold produced what the frame reports to the instant the frame reached the connection's outbox, and a frame with no fold behind it (the fresh reset a just-opened subscription is owed) is COUNTED but not TIMED — which is why the two latency fields are optional and their absence means `no frame here had a fold behind it`, never `zero microseconds`.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "PerfServeSource",
///  "description": "ONE SOURCE'S SERVE PATH, cumulative for this generation — the counters `views::meter` keeps, exactly as ruling 19 names them. QUEUE TIME IS NEVER COUNTED AS COMPUTE: `foldToFrameUs*` is measured from the instant the fold produced what the frame reports to the instant the frame reached the connection's outbox, and a frame with no fold behind it (the fresh reset a just-opened subscription is owed) is COUNTED but not TIMED — which is why the two latency fields are optional and their absence means `no frame here had a fold behind it`, never `zero microseconds`.",
///  "type": "object",
///  "required": [
///    "diffs",
///    "frames",
///    "payloadWeight",
///    "resets",
///    "rows",
///    "source",
///    "subscribers",
///    "widestPayloadWeight"
///  ],
///  "properties": {
///    "diffs": {
///      "type": "integer"
///    },
///    "foldToFrameUsMax": {
///      "description": "The worst timed frame, in microseconds.",
///      "type": "integer"
///    },
///    "foldToFrameUsMean": {
///      "description": "Mean fold-to-frame latency in MICROSECONDS, over the timed frames only. Microseconds rather than milliseconds because cutting a fifty-row window off a fold takes tens of them, and a serve path reporting `0 ms` reads as a measurement nobody took.",
///      "type": "integer"
///    },
///    "frames": {
///      "description": "Frames actually sent — `resets + diffs`. Reported rather than left to the caller's addition so the row reads without arithmetic.",
///      "type": "integer"
///    },
///    "payloadWeight": {
///      "description": "HOW MUCH THIS SOURCE HAS SENT, cumulative — the payload budget ruling 4 asks for, weighed off the frames' own serializations. THE UNIT IS IN THIS SENTENCE AND NOT IN THE NAME, and that is this schema keeping its own law rather than dodging it: a property name here may not carry a wire unit, because a schema that grew a byte count would quietly make the transport unswappable (the owner's constraint, enforced structurally in tests/protocolSchema.test.mts) — while the prose is exactly where a measurement is allowed to say what it measured. It is bytes of the JSON this engine serialized, so a different encoding would weigh the same frames differently: a client compares this against itself over time, never against a constant. `weight` is the vocabulary this repo already uses for the size of a committed thing (scripts/gen-data-weight.mts).",
///      "type": "integer"
///    },
///    "resets": {
///      "type": "integer"
///    },
///    "rows": {
///      "description": "Rows carried by the resets. A diff carries ops, not rows.",
///      "type": "integer"
///    },
///    "source": {
///      "description": "The view source's name, exactly as the source registry spells it.",
///      "type": "string"
///    },
///    "subscribers": {
///      "description": "Open subscriptions over this source RIGHT NOW, across every connection — a live count, not a cumulative one, and the world's answer rather than the meter's. It is what makes a row with no recent frames readable: nobody is watching, as against nothing is moving.",
///      "type": "integer"
///    },
///    "widestPayloadWeight": {
///      "description": "The largest single frame, weighed the same way. The budget number that matters — a mean hides the one frame that stalled a window.",
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct PerfServeSource {
    pub diffs: i64,
    ///The worst timed frame, in microseconds.
    #[serde(
        rename = "foldToFrameUsMax",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub fold_to_frame_us_max: ::std::option::Option<i64>,
    ///Mean fold-to-frame latency in MICROSECONDS, over the timed frames only. Microseconds rather than milliseconds because cutting a fifty-row window off a fold takes tens of them, and a serve path reporting `0 ms` reads as a measurement nobody took.
    #[serde(
        rename = "foldToFrameUsMean",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub fold_to_frame_us_mean: ::std::option::Option<i64>,
    ///Frames actually sent — `resets + diffs`. Reported rather than left to the caller's addition so the row reads without arithmetic.
    pub frames: i64,
    ///HOW MUCH THIS SOURCE HAS SENT, cumulative — the payload budget ruling 4 asks for, weighed off the frames' own serializations. THE UNIT IS IN THIS SENTENCE AND NOT IN THE NAME, and that is this schema keeping its own law rather than dodging it: a property name here may not carry a wire unit, because a schema that grew a byte count would quietly make the transport unswappable (the owner's constraint, enforced structurally in tests/protocolSchema.test.mts) — while the prose is exactly where a measurement is allowed to say what it measured. It is bytes of the JSON this engine serialized, so a different encoding would weigh the same frames differently: a client compares this against itself over time, never against a constant. `weight` is the vocabulary this repo already uses for the size of a committed thing (scripts/gen-data-weight.mts).
    #[serde(rename = "payloadWeight")]
    pub payload_weight: i64,
    pub resets: i64,
    ///Rows carried by the resets. A diff carries ops, not rows.
    pub rows: i64,
    ///The view source's name, exactly as the source registry spells it.
    pub source: ::std::string::String,
    ///Open subscriptions over this source RIGHT NOW, across every connection — a live count, not a cumulative one, and the world's answer rather than the meter's. It is what makes a row with no recent frames readable: nobody is watching, as against nothing is moving.
    pub subscribers: i64,
    ///The largest single frame, weighed the same way. The budget number that matters — a mean hides the one frame that stalled a window.
    #[serde(rename = "widestPayloadWeight")]
    pub widest_payload_weight: i64,
}
///THE ENGINE'S OWN PERFORMANCE, ASKED FOR (owner ruling 19 surface, JOS-483). Everything `session.health` says about where the fold has got to, plus what the ingest cost to build and what the serve path has cost since — the counters `views::meter` already keeps, read WITHOUT resetting them so two asks read as a progression rather than as two disconnected windows. It is answered through the same one door `module.snapshot` uses: the meter lives on the ingest thread, the request arrives on a connection thread, and the ingest answers at a boundary it already reaches. THE APP MUST NOT POLL THIS IDLY. It is the in-app performance panel's data and the panel is open a few seconds at a time; a perf surface that costs a round trip a second while nobody is looking at it is the bug it exists to find.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "PerfSnapshotRequest",
///  "description": "THE ENGINE'S OWN PERFORMANCE, ASKED FOR (owner ruling 19 surface, JOS-483). Everything `session.health` says about where the fold has got to, plus what the ingest cost to build and what the serve path has cost since — the counters `views::meter` already keeps, read WITHOUT resetting them so two asks read as a progression rather than as two disconnected windows. It is answered through the same one door `module.snapshot` uses: the meter lives on the ingest thread, the request arrives on a connection thread, and the ingest answers at a boundary it already reaches. THE APP MUST NOT POLL THIS IDLY. It is the in-app performance panel's data and the panel is open a few seconds at a time; a perf surface that costs a round trip a second while nobody is looking at it is the bug it exists to find.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "perf.snapshot"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/NoParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct PerfSnapshotRequest {
    pub id: RequestId,
    pub op: PerfSnapshotRequestOp,
    pub params: NoParams,
}
///`PerfSnapshotRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "perf.snapshot"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum PerfSnapshotRequestOp {
    #[serde(rename = "perf.snapshot")]
    PerfSnapshot,
}
impl ::std::fmt::Display for PerfSnapshotRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::PerfSnapshot => f.write_str("perf.snapshot"),
        }
    }
}
impl ::std::str::FromStr for PerfSnapshotRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "perf.snapshot" => Ok(Self::PerfSnapshot),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for PerfSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for PerfSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PerfSnapshotRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///What the engine is doing and what it has cost. The first five fields are `HealthResult`'s and mean exactly what they mean there, restated rather than nested so a panel reads one object — and OPTIONAL on the same terms, because a health answer given before any attach honestly has no mark, no event count and no log timestamp. `ingest` is what building this generation cost; `serve` is one row per view source, cumulative for the generation.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "PerfSnapshotResult",
///  "description": "What the engine is doing and what it has cost. The first five fields are `HealthResult`'s and mean exactly what they mean there, restated rather than nested so a panel reads one object — and OPTIONAL on the same terms, because a health answer given before any attach honestly has no mark, no event count and no log timestamp. `ingest` is what building this generation cost; `serve` is one row per view source, cumulative for the generation.",
///  "type": "object",
///  "required": [
///    "epoch",
///    "ingest",
///    "serve",
///    "status",
///    "uptimeMs"
///  ],
///  "properties": {
///    "epoch": {
///      "$ref": "#/$defs/Epoch"
///    },
///    "events": {
///      "description": "Events folded in this generation. Counts EVENTS, not lines — the same number `HealthResult.events` carries.",
///      "type": "integer"
///    },
///    "ingest": {
///      "$ref": "#/$defs/PerfIngest"
///    },
///    "lastEventTs": {
///      "description": "The `ts` of the last event folded — THE LOG'S OWN CLOCK, never the host's. Its distance from the host's clock is the freshness figure the panel draws, and that subtraction is the CALLER's to make: the engine does not read a wall clock to answer this.",
///      "type": "integer"
///    },
///    "mark": {
///      "$ref": "#/$defs/LogMark"
///    },
///    "serve": {
///      "description": "One row per view source that has served a frame in this generation. A source nobody has subscribed to is ABSENT rather than a row of zeros — the same rule the panel applies to a process type with no process behind it.",
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/PerfServeSource"
///      }
///    },
///    "status": {
///      "type": "string",
///      "enum": [
///        "starting",
///        "attaching",
///        "folding",
///        "live",
///        "idle"
///      ]
///    },
///    "uptimeMs": {
///      "description": "How long THIS PROCESS has been up. Process metadata, never world state: it survives an attach, which the epoch does not.",
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct PerfSnapshotResult {
    pub epoch: Epoch,
    ///Events folded in this generation. Counts EVENTS, not lines — the same number `HealthResult.events` carries.
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub events: ::std::option::Option<i64>,
    pub ingest: PerfIngest,
    ///The `ts` of the last event folded — THE LOG'S OWN CLOCK, never the host's. Its distance from the host's clock is the freshness figure the panel draws, and that subtraction is the CALLER's to make: the engine does not read a wall clock to answer this.
    #[serde(
        rename = "lastEventTs",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub last_event_ts: ::std::option::Option<i64>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub mark: ::std::option::Option<LogMark>,
    ///One row per view source that has served a frame in this generation. A source nobody has subscribed to is ABSENT rather than a row of zeros — the same rule the panel applies to a process type with no process behind it.
    pub serve: ::std::vec::Vec<PerfServeSource>,
    pub status: PerfSnapshotResultStatus,
    ///How long THIS PROCESS has been up. Process metadata, never world state: it survives an attach, which the epoch does not.
    #[serde(rename = "uptimeMs")]
    pub uptime_ms: i64,
}
///`PerfSnapshotResultStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "starting",
///    "attaching",
///    "folding",
///    "live",
///    "idle"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum PerfSnapshotResultStatus {
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "attaching")]
    Attaching,
    #[serde(rename = "folding")]
    Folding,
    #[serde(rename = "live")]
    Live,
    #[serde(rename = "idle")]
    Idle,
}
impl ::std::fmt::Display for PerfSnapshotResultStatus {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Starting => f.write_str("starting"),
            Self::Attaching => f.write_str("attaching"),
            Self::Folding => f.write_str("folding"),
            Self::Live => f.write_str("live"),
            Self::Idle => f.write_str("idle"),
        }
    }
}
impl ::std::str::FromStr for PerfSnapshotResultStatus {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "starting" => Ok(Self::Starting),
            "attaching" => Ok(Self::Attaching),
            "folding" => Ok(Self::Folding),
            "live" => Ok(Self::Live),
            "idle" => Ok(Self::Idle),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for PerfSnapshotResultStatus {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for PerfSnapshotResultStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PerfSnapshotResultStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ProtocolError`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ProtocolError",
///  "type": "object",
///  "required": [
///    "code",
///    "message"
///  ],
///  "properties": {
///    "code": {
///      "$ref": "#/$defs/ErrorCode"
///    },
///    "message": {
///      "description": "Human-readable, for a log line and a bug report. Never parsed — branch on `code`.",
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ProtocolError {
    pub code: ErrorCode,
    ///Human-readable, for a log line and a bug report. Never parsed — branch on `code`.
    pub message: ::std::string::String,
}
///Anything that can travel the wire, in either direction. The transport adapters are generic over exactly this: a transport moves ProtocolMessages and knows nothing else about the protocol.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "$id": "https://everquest-companion.local/protocol",
///  "title": "ProtocolMessage",
///  "description": "Anything that can travel the wire, in either direction. The transport adapters are generic over exactly this: a transport moves ProtocolMessages and knows nothing else about the protocol.",
///  "oneOf": [
///    {
///      "$ref": "#/$defs/ClientMessage"
///    },
///    {
///      "$ref": "#/$defs/EngineMessage"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum ProtocolMessage {
    ClientMessage(ClientMessage),
    EngineMessage(EngineMessage),
}
impl ::std::convert::From<ClientMessage> for ProtocolMessage {
    fn from(value: ClientMessage) -> Self {
        Self::ClientMessage(value)
    }
}
impl ::std::convert::From<EngineMessage> for ProtocolMessage {
    fn from(value: EngineMessage) -> Self {
        Self::EngineMessage(value)
    }
}
///A successful answer to one request.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "Reply",
///  "description": "A successful answer to one request.",
///  "type": "object",
///  "required": [
///    "id",
///    "kind",
///    "ok",
///    "result"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "reply"
///      ]
///    },
///    "ok": {
///      "type": "boolean",
///      "enum": [
///        true
///      ]
///    },
///    "result": {
///      "$ref": "#/$defs/ReplyResult"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub id: RequestId,
    pub kind: ReplyKind,
    pub ok: bool,
    pub result: ReplyResult,
}
///`ReplyKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "reply"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ReplyKind {
    #[serde(rename = "reply")]
    Reply,
}
impl ::std::fmt::Display for ReplyKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Reply => f.write_str("reply"),
        }
    }
}
impl ::std::str::FromStr for ReplyKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "reply" => Ok(Self::Reply),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ReplyKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///THE RESULT REGISTRY, and it is CLOSED. Which shape a reply carries is decided by the OP of the request whose id it names - the envelope does not repeat it, because a reply that had to restate its own op would be a second place for the two to disagree. This list is the additive seam for the eight API surfaces: a new op adds an arm and nothing else in the envelope moves. There is deliberately NO open arm for a shape this build does not know: both sides generate from this one artifact and a protocolVersion mismatch is fatal at hello, so an engine that could answer with an unnamed shape is an engine this client already refused to talk to. A wildcard arm would also make the whole list unusable - an open object matches every named shape too, so `oneOf` could never pick one.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ReplyResult",
///  "description": "THE RESULT REGISTRY, and it is CLOSED. Which shape a reply carries is decided by the OP of the request whose id it names - the envelope does not repeat it, because a reply that had to restate its own op would be a second place for the two to disagree. This list is the additive seam for the eight API surfaces: a new op adds an arm and nothing else in the envelope moves. There is deliberately NO open arm for a shape this build does not know: both sides generate from this one artifact and a protocolVersion mismatch is fatal at hello, so an engine that could answer with an unnamed shape is an engine this client already refused to talk to. A wildcard arm would also make the whole list unusable - an open object matches every named shape too, so `oneOf` could never pick one.",
///  "oneOf": [
///    {
///      "$ref": "#/$defs/EchoResult"
///    },
///    {
///      "$ref": "#/$defs/HealthResult"
///    },
///    {
///      "$ref": "#/$defs/AttachResult"
///    },
///    {
///      "$ref": "#/$defs/SubscribeAck"
///    },
///    {
///      "$ref": "#/$defs/ModuleSnapshotResult"
///    },
///    {
///      "$ref": "#/$defs/PerfSnapshotResult"
///    },
///    {
///      "$ref": "#/$defs/DefineAck"
///    },
///    {
///      "$ref": "#/$defs/CombatSnapshotResult"
///    },
///    {
///      "$ref": "#/$defs/CombatSearchFightsResult"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum ReplyResult {
    EchoResult(EchoResult),
    HealthResult(HealthResult),
    AttachResult(AttachResult),
    SubscribeAck(SubscribeAck),
    ModuleSnapshotResult(ModuleSnapshotResult),
    PerfSnapshotResult(PerfSnapshotResult),
    DefineAck(DefineAck),
    CombatSnapshotResult(CombatSnapshotResult),
    CombatSearchFightsResult(CombatSearchFightsResult),
}
impl ::std::convert::From<EchoResult> for ReplyResult {
    fn from(value: EchoResult) -> Self {
        Self::EchoResult(value)
    }
}
impl ::std::convert::From<HealthResult> for ReplyResult {
    fn from(value: HealthResult) -> Self {
        Self::HealthResult(value)
    }
}
impl ::std::convert::From<AttachResult> for ReplyResult {
    fn from(value: AttachResult) -> Self {
        Self::AttachResult(value)
    }
}
impl ::std::convert::From<SubscribeAck> for ReplyResult {
    fn from(value: SubscribeAck) -> Self {
        Self::SubscribeAck(value)
    }
}
impl ::std::convert::From<ModuleSnapshotResult> for ReplyResult {
    fn from(value: ModuleSnapshotResult) -> Self {
        Self::ModuleSnapshotResult(value)
    }
}
impl ::std::convert::From<PerfSnapshotResult> for ReplyResult {
    fn from(value: PerfSnapshotResult) -> Self {
        Self::PerfSnapshotResult(value)
    }
}
impl ::std::convert::From<DefineAck> for ReplyResult {
    fn from(value: DefineAck) -> Self {
        Self::DefineAck(value)
    }
}
impl ::std::convert::From<CombatSnapshotResult> for ReplyResult {
    fn from(value: CombatSnapshotResult) -> Self {
        Self::CombatSnapshotResult(value)
    }
}
impl ::std::convert::From<CombatSearchFightsResult> for ReplyResult {
    fn from(value: CombatSearchFightsResult) -> Self {
        Self::CombatSearchFightsResult(value)
    }
}
///Client-chosen correlation id. A reply carries the id of its request; every stream message carries the id of the subscribe request that opened it.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RequestId",
///  "description": "Client-chosen correlation id. A reply carries the id of its request; every stream message carries the id of the subscribe request that opened it.",
///  "type": "integer"
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct RequestId(pub i64);
impl ::std::ops::Deref for RequestId {
    type Target = i64;
    fn deref(&self) -> &i64 {
        &self.0
    }
}
impl ::std::convert::From<RequestId> for i64 {
    fn from(value: RequestId) -> Self {
        value.0
    }
}
impl ::std::convert::From<i64> for RequestId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl ::std::str::FromStr for RequestId {
    type Err = <i64 as ::std::str::FromStr>::Err;
    fn from_str(value: &str) -> ::std::result::Result<Self, Self::Err> {
        Ok(Self(value.parse()?))
    }
}
impl ::std::convert::TryFrom<&str> for RequestId {
    type Error = <i64 as ::std::str::FromStr>::Err;
    fn try_from(value: &str) -> ::std::result::Result<Self, Self::Error> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<String> for RequestId {
    type Error = <i64 as ::std::str::FromStr>::Err;
    fn try_from(value: String) -> ::std::result::Result<Self, Self::Error> {
        value.parse()
    }
}
impl ::std::fmt::Display for RequestId {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        self.0.fmt(f)
    }
}
///The whole window, as of now. Every subscription opens with one, and every epoch bump produces a new one once the fold lands.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ResetMessage",
///  "description": "The whole window, as of now. Every subscription opens with one, and every epoch bump produces a new one once the fold lands.",
///  "type": "object",
///  "required": [
///    "epoch",
///    "id",
///    "kind",
///    "rows",
///    "total"
///  ],
///  "properties": {
///    "epoch": {
///      "$ref": "#/$defs/Epoch"
///    },
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "reset"
///      ]
///    },
///    "rows": {
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/Row"
///      }
///    },
///    "total": {
///      "description": "How many rows the view holds in total, ignoring the window — what a `1–50 of 1834` line reads off.",
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ResetMessage {
    pub epoch: Epoch,
    pub id: RequestId,
    pub kind: ResetMessageKind,
    pub rows: ::std::vec::Vec<Row>,
    ///How many rows the view holds in total, ignoring the window — what a `1–50 of 1834` line reads off.
    pub total: i64,
}
///`ResetMessageKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "reset"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ResetMessageKind {
    #[serde(rename = "reset")]
    Reset,
}
impl ::std::fmt::Display for ResetMessageKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Reset => f.write_str("reset"),
        }
    }
}
impl ::std::str::FromStr for ResetMessageKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "reset" => Ok(Self::Reset),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ResetMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ResetMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ResetMessageKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`RespawnDefineParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RespawnDefineParams",
///  "type": "object",
///  "required": [
///    "prefs"
///  ],
///  "properties": {
///    "prefs": {
///      "$ref": "#/$defs/RespawnPrefs"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct RespawnDefineParams {
    pub prefs: RespawnPrefs,
}
///WHICH MOBS GET A CLOCK (JOS-194) — tracking is opt-in per mob, so this list is the whole of what the respawn fold knows that the log did not tell it.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RespawnDefineRequest",
///  "description": "WHICH MOBS GET A CLOCK (JOS-194) — tracking is opt-in per mob, so this list is the whole of what the respawn fold knows that the log did not tell it.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "respawn.define"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/RespawnDefineParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct RespawnDefineRequest {
    pub id: RequestId,
    pub op: RespawnDefineRequestOp,
    pub params: RespawnDefineParams,
}
///`RespawnDefineRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "respawn.define"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum RespawnDefineRequestOp {
    #[serde(rename = "respawn.define")]
    RespawnDefine,
}
impl ::std::fmt::Display for RespawnDefineRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::RespawnDefine => f.write_str("respawn.define"),
        }
    }
}
impl ::std::str::FromStr for RespawnDefineRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "respawn.define" => Ok(Self::RespawnDefine),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for RespawnDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for RespawnDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for RespawnDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`src/shared/respawn.ts RespawnPrefs`. An object rather than a bare array because that is the shape the store holds and the shape a later preference would grow into.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RespawnPrefs",
///  "description": "`src/shared/respawn.ts RespawnPrefs`. An object rather than a bare array because that is the shape the store holds and the shape a later preference would grow into.",
///  "type": "object",
///  "required": [
///    "watches"
///  ],
///  "properties": {
///    "watches": {
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/RespawnWatch"
///      }
///    }
///  },
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct RespawnPrefs {
    pub watches: ::std::vec::Vec<RespawnWatch>,
}
///One mob the user chose to watch, and the number they typed if they typed one.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RespawnWatch",
///  "description": "One mob the user chose to watch, and the number they typed if they typed one.",
///  "type": "object",
///  "required": [
///    "display",
///    "key"
///  ],
///  "properties": {
///    "customSec": {
///      "description": "The user's own respawn, in SECONDS. Absent means `use what you learn`, which is a different statement from zero.",
///      "type": "integer"
///    },
///    "display": {
///      "type": "string"
///    },
///    "key": {
///      "description": "Canonical (lowercased) mob name — what a death line's name canonicalizes to.",
///      "type": "string"
///    }
///  },
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct RespawnWatch {
    ///The user's own respawn, in SECONDS. Absent means `use what you learn`, which is a different statement from zero.
    #[serde(
        rename = "customSec",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub custom_sec: ::std::option::Option<i64>,
    pub display: ::std::string::String,
    ///Canonical (lowercased) mob name — what a death line's name canonicalizes to.
    pub key: ::std::string::String,
}
///`RosterDefineParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RosterDefineParams",
///  "type": "object",
///  "required": [
///    "edits"
///  ],
///  "properties": {
///    "edits": {
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/RosterEdit"
///      }
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct RosterDefineParams {
    pub edits: ::std::vec::Vec<RosterEdit>,
}
///THE USER'S GROUP-ROSTER EDITS — names they added the log never named, and names they removed that it did.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RosterDefineRequest",
///  "description": "THE USER'S GROUP-ROSTER EDITS — names they added the log never named, and names they removed that it did.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "roster.define"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/RosterDefineParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct RosterDefineRequest {
    pub id: RequestId,
    pub op: RosterDefineRequestOp,
    pub params: RosterDefineParams,
}
///`RosterDefineRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "roster.define"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum RosterDefineRequestOp {
    #[serde(rename = "roster.define")]
    RosterDefine,
}
impl ::std::fmt::Display for RosterDefineRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::RosterDefine => f.write_str("roster.define"),
        }
    }
}
impl ::std::str::FromStr for RosterDefineRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "roster.define" => Ok(Self::RosterDefine),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for RosterDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for RosterDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for RosterDefineRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`src/shared/progressState.ts RosterEdit` — one name, one verb, and the instant the user said it. The instant is load-bearing rather than provenance: an edit older than the last character rebirth, or older than the last `You have been removed from the group.`, described a group that no longer exists and is dropped by the fold rather than by the pusher.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RosterEdit",
///  "description": "`src/shared/progressState.ts RosterEdit` — one name, one verb, and the instant the user said it. The instant is load-bearing rather than provenance: an edit older than the last character rebirth, or older than the last `You have been removed from the group.`, described a group that no longer exists and is dropped by the fold rather than by the pusher.",
///  "type": "object",
///  "required": [
///    "action",
///    "key",
///    "name",
///    "setAt"
///  ],
///  "properties": {
///    "action": {
///      "type": "string",
///      "enum": [
///        "add",
///        "remove"
///      ]
///    },
///    "key": {
///      "description": "The canonical identity key — `idKey(name)`.",
///      "type": "string"
///    },
///    "name": {
///      "type": "string"
///    },
///    "setAt": {
///      "type": "integer"
///    }
///  },
///  "additionalProperties": true
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct RosterEdit {
    pub action: RosterEditAction,
    ///The canonical identity key — `idKey(name)`.
    pub key: ::std::string::String,
    pub name: ::std::string::String,
    #[serde(rename = "setAt")]
    pub set_at: i64,
}
///`RosterEditAction`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "add",
///    "remove"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum RosterEditAction {
    #[serde(rename = "add")]
    Add,
    #[serde(rename = "remove")]
    Remove,
}
impl ::std::fmt::Display for RosterEditAction {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Add => f.write_str("add"),
            Self::Remove => f.write_str("remove"),
        }
    }
}
impl ::std::str::FromStr for RosterEditAction {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "add" => Ok(Self::Add),
            "remove" => Ok(Self::Remove),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for RosterEditAction {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for RosterEditAction {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for RosterEditAction {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///One render-ready row: its key and its cells. THE KEY IS OUTSIDE THE CELLS on purpose — an `update` op carries `cells` alone, so reset rows and diff updates have to agree on where the identity lives or a client cannot apply a diff to a row it already holds.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "Row",
///  "description": "One render-ready row: its key and its cells. THE KEY IS OUTSIDE THE CELLS on purpose — an `update` op carries `cells` alone, so reset rows and diff updates have to agree on where the identity lives or a client cannot apply a diff to a row it already holds.",
///  "type": "object",
///  "required": [
///    "cells",
///    "key"
///  ],
///  "properties": {
///    "cells": {
///      "$ref": "#/$defs/Cells"
///    },
///    "key": {
///      "$ref": "#/$defs/RowKey"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub cells: Cells,
    pub key: RowKey,
}
///Stable identity of a row within one view, e.g. `loot:9413` or `ally:Primitive`. Unique inside a subscription; meaningless outside it.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "RowKey",
///  "description": "Stable identity of a row within one view, e.g. `loot:9413` or `ally:Primitive`. Unique inside a subscription; meaningless outside it.",
///  "type": "string"
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize, ::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd,
)]
#[serde(transparent)]
pub struct RowKey(pub ::std::string::String);
impl ::std::ops::Deref for RowKey {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<RowKey> for ::std::string::String {
    fn from(value: RowKey) -> Self {
        value.0
    }
}
impl ::std::convert::From<::std::string::String> for RowKey {
    fn from(value: ::std::string::String) -> Self {
        Self(value)
    }
}
impl ::std::str::FromStr for RowKey {
    type Err = ::std::convert::Infallible;
    fn from_str(value: &str) -> ::std::result::Result<Self, Self::Err> {
        Ok(Self(value.to_string()))
    }
}
impl ::std::fmt::Display for RowKey {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        self.0.fmt(f)
    }
}
///`SessionAttachParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "SessionAttachParams",
///  "type": "object",
///  "required": [
///    "logPath"
///  ],
///  "properties": {
///    "logPath": {
///      "description": "Absolute path to the EverQuest log file. The engine never discovers a path of its own and never reads a settings file — the app owns discovery and pushes the answer in.",
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SessionAttachParams {
    ///Absolute path to the EverQuest log file. The engine never discovers a path of its own and never reads a settings file — the app owns discovery and pushes the answer in.
    #[serde(rename = "logPath")]
    pub log_path: ::std::string::String,
}
///Begins tail + fold of one log. PREEMPTS any in-flight attach — last pick wins, never queued (JOS-457's generation ownership, promoted to protocol law). A successful attach bumps the epoch.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "SessionAttachRequest",
///  "description": "Begins tail + fold of one log. PREEMPTS any in-flight attach — last pick wins, never queued (JOS-457's generation ownership, promoted to protocol law). A successful attach bumps the epoch.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "session.attach"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/SessionAttachParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SessionAttachRequest {
    pub id: RequestId,
    pub op: SessionAttachRequestOp,
    pub params: SessionAttachParams,
}
///`SessionAttachRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "session.attach"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum SessionAttachRequestOp {
    #[serde(rename = "session.attach")]
    SessionAttach,
}
impl ::std::fmt::Display for SessionAttachRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::SessionAttach => f.write_str("session.attach"),
        }
    }
}
impl ::std::str::FromStr for SessionAttachRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "session.attach" => Ok(Self::SessionAttach),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for SessionAttachRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for SessionAttachRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for SessionAttachRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`SessionHealthRequest`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "SessionHealthRequest",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "session.health"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/NoParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SessionHealthRequest {
    pub id: RequestId,
    pub op: SessionHealthRequestOp,
    pub params: NoParams,
}
///`SessionHealthRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "session.health"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum SessionHealthRequestOp {
    #[serde(rename = "session.health")]
    SessionHealth,
}
impl ::std::fmt::Display for SessionHealthRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::SessionHealth => f.write_str("session.health"),
        }
    }
}
impl ::std::str::FromStr for SessionHealthRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "session.health" => Ok(Self::SessionHealth),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for SessionHealthRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for SessionHealthRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for SessionHealthRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///Asks to be told about fold progress. The ticks themselves arrive as connection-wide EpochMessage frames carrying `progress` — the same channel the epoch bump uses, which is why they are not a fourth stream kind.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "SessionProgressRequest",
///  "description": "Asks to be told about fold progress. The ticks themselves arrive as connection-wide EpochMessage frames carrying `progress` — the same channel the epoch bump uses, which is why they are not a fourth stream kind.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "session.progress"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/NoParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SessionProgressRequest {
    pub id: RequestId,
    pub op: SessionProgressRequestOp,
    pub params: NoParams,
}
///`SessionProgressRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "session.progress"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum SessionProgressRequestOp {
    #[serde(rename = "session.progress")]
    SessionProgress,
}
impl ::std::fmt::Display for SessionProgressRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::SessionProgress => f.write_str("session.progress"),
        }
    }
}
impl ::std::str::FromStr for SessionProgressRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "session.progress" => Ok(Self::SessionProgress),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for SessionProgressRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for SessionProgressRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for SessionProgressRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///One sort key as the pair the plan doc writes: ["at","desc"]. THE DOUBLE SPELLING IS DELIBERATE. A draft 2020-12 VALIDATOR reads `prefixItems` and therefore enforces that the second element is asc or desc - that is the real contract. Both CODE GENERATORS predate or ignore that keyword and read `items` + minItems/maxItems instead, landing on a fixed-length array of strings in each language. The two can never disagree about a legal value: with minItems = maxItems = 2 there is no element left for `items` to reach under 2020-12 semantics, so the fallback is vacuous for a compliant validator and merely weaker for a generator. Anything the generated types accept and the validator rejects is caught by the fixture suite, which validates every message against the schema itself.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "SortTerm",
///  "description": "One sort key as the pair the plan doc writes: [\"at\",\"desc\"]. THE DOUBLE SPELLING IS DELIBERATE. A draft 2020-12 VALIDATOR reads `prefixItems` and therefore enforces that the second element is asc or desc - that is the real contract. Both CODE GENERATORS predate or ignore that keyword and read `items` + minItems/maxItems instead, landing on a fixed-length array of strings in each language. The two can never disagree about a legal value: with minItems = maxItems = 2 there is no element left for `items` to reach under 2020-12 semantics, so the fallback is vacuous for a compliant validator and merely weaker for a generator. Anything the generated types accept and the validator rejects is caught by the fixture suite, which validates every message against the schema itself.",
///  "type": "array",
///  "items": {
///    "type": "string"
///  },
///  "maxItems": 2,
///  "minItems": 2,
///  "prefixItems": [
///    {
///      "type": "string"
///    },
///    {
///      "enum": [
///        "asc",
///        "desc"
///      ],
///      "type": "string"
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct SortTerm(pub [::std::string::String; 2usize]);
impl ::std::ops::Deref for SortTerm {
    type Target = [::std::string::String; 2usize];
    fn deref(&self) -> &[::std::string::String; 2usize] {
        &self.0
    }
}
impl ::std::convert::From<SortTerm> for [::std::string::String; 2usize] {
    fn from(value: SortTerm) -> Self {
        value.0
    }
}
impl ::std::convert::From<[::std::string::String; 2usize]> for SortTerm {
    fn from(value: [::std::string::String; 2usize]) -> Self {
        Self(value)
    }
}
///`SubscribeAck`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "SubscribeAck",
///  "type": "object",
///  "required": [
///    "subscribed",
///    "subscription"
///  ],
///  "properties": {
///    "subscribed": {
///      "type": "boolean"
///    },
///    "subscription": {
///      "$ref": "#/$defs/RequestId"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SubscribeAck {
    pub subscribed: bool,
    pub subscription: RequestId,
}
///The per-launch shared secret. Minted by Electron main at spawn, handed to the engine out of band, presented once at hello. It is never persisted and never reused across launches. Compare it in CONSTANT TIME (src/main/dataServer/token.ts, engine/crates/protocol/src/token.rs) - a byte-at-a-time compare over a loopback socket is a timing oracle. The shape rules are environment-neutral and live in src/shared/dataServer/token.ts.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "Token",
///  "description": "The per-launch shared secret. Minted by Electron main at spawn, handed to the engine out of band, presented once at hello. It is never persisted and never reused across launches. Compare it in CONSTANT TIME (src/main/dataServer/token.ts, engine/crates/protocol/src/token.rs) - a byte-at-a-time compare over a loopback socket is a timing oracle. The shape rules are environment-neutral and live in src/shared/dataServer/token.ts.",
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 32
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct Token(::std::string::String);
impl ::std::ops::Deref for Token {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<Token> for ::std::string::String {
    fn from(value: Token) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for Token {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 32usize {
            return Err("shorter than 32 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for Token {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for Token {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for Token {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for Token {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///CHANGED CELLS ONLY. A cell absent from `cells` is unchanged, never cleared — clearing is an explicit null.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "UpdateOp",
///  "description": "CHANGED CELLS ONLY. A cell absent from `cells` is unchanged, never cleared — clearing is an explicit null.",
///  "type": "object",
///  "required": [
///    "cells",
///    "key",
///    "op"
///  ],
///  "properties": {
///    "cells": {
///      "$ref": "#/$defs/Cells"
///    },
///    "key": {
///      "$ref": "#/$defs/RowKey"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "update"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct UpdateOp {
    pub cells: Cells,
    pub key: RowKey,
    pub op: UpdateOpOp,
}
///`UpdateOpOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "update"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum UpdateOpOp {
    #[serde(rename = "update")]
    Update,
}
impl ::std::fmt::Display for UpdateOpOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Update => f.write_str("update"),
        }
    }
}
impl ::std::str::FromStr for UpdateOpOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "update" => Ok(Self::Update),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for UpdateOpOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for UpdateOpOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for UpdateOpOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ViewDescriptor`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ViewDescriptor",
///  "type": "object",
///  "required": [
///    "source"
///  ],
///  "properties": {
///    "filter": {
///      "$ref": "#/$defs/ViewFilter"
///    },
///    "sort": {
///      "type": "array",
///      "items": {
///        "$ref": "#/$defs/SortTerm"
///      }
///    },
///    "source": {
///      "description": "Which collection the view reads, e.g. `loot.ledger` or `combat.live`. The engine owns the registry of sources; an unknown one is a `notFound` error, never an empty result.",
///      "type": "string"
///    },
///    "window": {
///      "$ref": "#/$defs/ViewWindow"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ViewDescriptor {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub filter: ::std::option::Option<ViewFilter>,
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub sort: ::std::vec::Vec<SortTerm>,
    ///Which collection the view reads, e.g. `loot.ledger` or `combat.live`. The engine owns the registry of sources; an unknown one is a `notFound` error, never an empty result.
    pub source: ::std::string::String,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub window: ::std::option::Option<ViewWindow>,
}
///Field-name to value, ANDed. Open by design for the same reason Cells is: which fields a source filters on is the SOURCE's contract, not the protocol's.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ViewFilter",
///  "description": "Field-name to value, ANDed. Open by design for the same reason Cells is: which fields a source filters on is the SOURCE's contract, not the protocol's.",
///  "type": "object",
///  "additionalProperties": {
///    "$ref": "#/$defs/Cell"
///  }
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct ViewFilter(pub ::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>);
impl ::std::ops::Deref for ViewFilter {
    type Target = ::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>;
    fn deref(&self) -> &::std::collections::BTreeMap<::std::string::String, crate::cell::Cell> {
        &self.0
    }
}
impl ::std::convert::From<ViewFilter>
    for ::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>
{
    fn from(value: ViewFilter) -> Self {
        value.0
    }
}
impl ::std::convert::From<::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>>
    for ViewFilter
{
    fn from(value: ::std::collections::BTreeMap<::std::string::String, crate::cell::Cell>) -> Self {
        Self(value)
    }
}
///Opens a subscription. The reply acknowledges; the data starts with a `reset` carrying the whole window.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ViewSubscribeRequest",
///  "description": "Opens a subscription. The reply acknowledges; the data starts with a `reset` carrying the whole window.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "view.subscribe"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/ViewDescriptor"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ViewSubscribeRequest {
    pub id: RequestId,
    pub op: ViewSubscribeRequestOp,
    pub params: ViewDescriptor,
}
///`ViewSubscribeRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "view.subscribe"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ViewSubscribeRequestOp {
    #[serde(rename = "view.subscribe")]
    ViewSubscribe,
}
impl ::std::fmt::Display for ViewSubscribeRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ViewSubscribe => f.write_str("view.subscribe"),
        }
    }
}
impl ::std::str::FromStr for ViewSubscribeRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "view.subscribe" => Ok(Self::ViewSubscribe),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ViewSubscribeRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ViewSubscribeRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ViewSubscribeRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ViewUnsubscribeParams`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ViewUnsubscribeParams",
///  "type": "object",
///  "required": [
///    "subscription"
///  ],
///  "properties": {
///    "subscription": {
///      "$ref": "#/$defs/RequestId"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ViewUnsubscribeParams {
    pub subscription: RequestId,
}
///Closes a subscription. `id` is this REQUEST's id; `params.subscription` names the subscribe request whose stream is to stop.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ViewUnsubscribeRequest",
///  "description": "Closes a subscription. `id` is this REQUEST's id; `params.subscription` names the subscribe request whose stream is to stop.",
///  "type": "object",
///  "required": [
///    "id",
///    "op",
///    "params"
///  ],
///  "properties": {
///    "id": {
///      "$ref": "#/$defs/RequestId"
///    },
///    "op": {
///      "type": "string",
///      "enum": [
///        "view.unsubscribe"
///      ]
///    },
///    "params": {
///      "$ref": "#/$defs/ViewUnsubscribeParams"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ViewUnsubscribeRequest {
    pub id: RequestId,
    pub op: ViewUnsubscribeRequestOp,
    pub params: ViewUnsubscribeParams,
}
///`ViewUnsubscribeRequestOp`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "view.unsubscribe"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ViewUnsubscribeRequestOp {
    #[serde(rename = "view.unsubscribe")]
    ViewUnsubscribe,
}
impl ::std::fmt::Display for ViewUnsubscribeRequestOp {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ViewUnsubscribe => f.write_str("view.unsubscribe"),
        }
    }
}
impl ::std::str::FromStr for ViewUnsubscribeRequestOp {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "view.unsubscribe" => Ok(Self::ViewUnsubscribe),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ViewUnsubscribeRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ViewUnsubscribeRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ViewUnsubscribeRequestOp {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///The slice of the sorted, filtered view the client wants. Absent means the engine's default window for that source — never `everything`, because an unbounded window is how a payload budget gets blown.
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ViewWindow",
///  "description": "The slice of the sorted, filtered view the client wants. Absent means the engine's default window for that source — never `everything`, because an unbounded window is how a payload budget gets blown.",
///  "type": "object",
///  "required": [
///    "limit",
///    "offset"
///  ],
///  "properties": {
///    "limit": {
///      "type": "integer"
///    },
///    "offset": {
///      "type": "integer"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ViewWindow {
    pub limit: i64,
    pub offset: i64,
}
/// THE WIRE VERSION. A single integer, bumped on any breaking change. A client presents it
/// in `Hello::protocol_version`; the engine answers with its own in
/// `HelloReply::protocol_version`. A mismatch is FATAL by ruling - both sides log and the
/// connection closes. Version skew is a build error, not a runtime state to recover from,
/// because both sides generate from this one artifact.
pub const PROTOCOL_VERSION: i64 = 1;

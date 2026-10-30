export const styles = `
.bsd-overlay {
  --bsd-bg: #fffdfb; --bsd-fg: #393640; --bsd-muted: #827b86;
  --bsd-soft: #faf4f5; --bsd-line: #ede5e8; --bsd-pink: #da6583; --bsd-shadow: #bc55752a;
  position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: #28212e82; backdrop-filter: blur(5px); box-sizing: border-box; color-scheme: light;
}
.bsd-overlay[hidden], .bsd-overlay [hidden] { display: none !important; }
.bsd-dialog {
  width: min(880px, 100%); min-width: 0; max-height: 90dvh; display: flex; flex-direction: column;
  color: var(--bsd-fg); background: var(--bsd-bg); border: 1px solid var(--bsd-line); border-radius: 26px;
  box-shadow: 0 30px 100px #16101d50; font: 14px/1.65 system-ui, sans-serif; text-align: left; overflow: hidden;
  animation: bsd-open .3s cubic-bezier(.2,.8,.2,1);
}
.bsd-dialog * { box-sizing: border-box; }
.bsd-dialog button, .bsd-dialog input, .bsd-dialog select { font: inherit; color: inherit; }
.bsd-dialog button { cursor: pointer; transition: transform .18s, box-shadow .18s, background .18s; }
.bsd-dialog button:disabled { opacity: .45; cursor: default; }
.bsd-dialog button:not(:disabled):active { transform: scale(.96); }
.bsd-dialog :focus, .bsd-entry-link:focus { outline: none; }
.bsd-overlay[data-focus="keyboard"] :focus, .bsd-entry-link[data-focus="keyboard"]:focus {
  outline: 2px solid #da6583; outline-color: var(--bsd-pink, #da6583); outline-offset: 3px;
}
.bsd-dialog button, .bsd-dialog a, .bsd-dialog input, .bsd-dialog select { -webkit-tap-highlight-color: transparent; }
.bsd-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 23px 30px 20px; flex: none; }
.bsd-header h2 { margin: 0; font-size: 23px; letter-spacing: -.04em; line-height: 1.4; color: var(--bsd-fg); }
.bsd-header small { display: block; margin-top: 3px; color: var(--bsd-muted); font-size: 12px; }
.bsd-dialog .bsd-close { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--bsd-line); background: none; border-radius: 50%; line-height: 1; flex: none; }
.bsd-close svg { display: block; width: 16px; height: 16px; pointer-events: none; }
.bsd-close:hover { background: var(--bsd-soft); }
.bsd-body { padding: 0 22px 5px; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--bsd-pink) transparent; }
.bsd-workspace { padding: 20px 22px 16px; border-radius: 20px; background: var(--bsd-soft); position: relative; overflow: hidden; }
.bsd-workspace::before { content: ""; position: absolute; inset: 0; opacity: .12; background-image: radial-gradient(var(--bsd-muted) .7px, transparent .7px); background-size: 23px 23px; pointer-events: none; }
.bsd-top { display: grid; grid-template-columns: minmax(0,1fr) 33px minmax(0,1fr); align-items: center; gap: 22px; position: relative; }
.bsd-endpoint { display: grid; grid-template-columns: 58px minmax(0,1fr); align-items: center; gap: 12px; min-width: 0; padding: 14px; border: 1px solid var(--bsd-line); border-radius: 20px; background: var(--bsd-bg); }
.bsd-avatar-link { display: block; border-radius: 11px; }
.bsd-avatar-link:not([href]) { cursor: default; }
.bsd-avatar-link img { display: block; border-radius: inherit; object-fit: cover; transition: transform .2s; }
.bsd-avatar-link[href]:hover img { transform: translateY(-4px) rotate(-3deg); }
.bsd-user-name { color: var(--bsd-fg); font-weight: 650; line-height: 1.65; }
.bsd-user-id { color: var(--bsd-muted); font-size: 11px; line-height: 1.65; }
.bsd-endpoint .bsd-avatar-link { border-radius: 19px; }
.bsd-avatar { display: block; width: 58px; height: 58px; background: var(--bsd-soft); box-shadow: 0 5px 14px var(--bsd-shadow); }
.bsd-endpoint-info { min-width: 0; }
.bsd-endpoint-label { display: block; margin-bottom: 2px; color: var(--bsd-muted); font-size: 10px; }
.bsd-endpoint-name, .bsd-endpoint-placeholder { display: block; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bsd-endpoint-placeholder { font-weight: 650; }
.bsd-input, .bsd-exclusions-input { display: flex; align-items: center; gap: 5px; min-width: 0; padding: 5px 10px; border: 1px solid var(--bsd-line); border-radius: 12px; font-size: 12px; color: var(--bsd-fg); }
.bsd-input > span, .bsd-exclusions-input > span { flex: none; }
.bsd-input input, .bsd-exclusions-input input { min-width: 0; width: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; font-size: 12px; box-shadow: none; }
.bsd-shortcuts { display: flex; flex-wrap: wrap; gap: 8px; }
.bsd-shortcuts button { padding: 4px 0 0; border: 0; background: none; color: var(--bsd-pink); font-size: 11px; box-shadow: none; }
.bsd-shortcuts button:hover { text-decoration: underline; }
.bsd-endpoint[data-randomizing="true"] .bsd-avatar { animation: bsd-shuffle .7s ease-in-out infinite; }
.bsd-swap { padding: 0; width: 33px; height: 33px; border: 1px solid var(--bsd-line); border-radius: 50%; background: var(--bsd-bg); color: var(--bsd-pink) !important; font-size: 19px !important; line-height: 1; }
.bsd-swap:hover:not(:disabled) { transform: rotate(180deg); }
.bsd-mode { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: center; gap: 10px; padding: 18px 0; position: relative; }
.bsd-mode-choice { grid-column: 2; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 10px; }
.bsd-dialog .bsd-exclusions-toggle { grid-column: 3; justify-self: end; white-space: nowrap; padding: 4px 2px; border: 0; border-radius: 4px; background: transparent; color: var(--bsd-muted); font-size: 11px; box-shadow: none; }
.bsd-exclusions-toggle::after { content: ""; display: inline-block; width: 6px; height: 6px; margin: 0 3px 3px 7px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
.bsd-exclusions-toggle[aria-expanded="true"]::after { margin-bottom: 0; transform: rotate(225deg); }
.bsd-dialog .bsd-exclusions-toggle:hover { color: var(--bsd-fg); background: #00000008; }
.bsd-dialog .bsd-exclusions-toggle:not(:disabled):active { transform: none; }
.bsd-exclusions { position: relative; margin-bottom: 18px; padding: 14px 16px; border: 1px solid var(--bsd-line); border-radius: 16px; background: var(--bsd-bg); }
.bsd-exclusions-note, .bsd-exclusions-empty, .bsd-exclusions-feedback, .bsd-exclusions-warning { margin: 0; color: var(--bsd-muted); font-size: 11px; overflow-wrap: anywhere; }
.bsd-exclusions-entry { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.bsd-exclusions-input { flex: 1; }
.bsd-exclusions-entry button { flex: none; padding: 5px 12px; border: 1px solid var(--bsd-line); border-radius: 14px; background: var(--bsd-soft); color: var(--bsd-pink); font-size: 12px; }
.bsd-exclusions-entry [data-action="cancel-excluded"] { padding-inline: 5px; border-color: transparent; background: transparent; color: var(--bsd-muted); }
.bsd-exclusions-feedback:not(:empty), .bsd-exclusions-warning, .bsd-exclusions-empty { margin-top: 8px; }
.bsd-exclusions-warning { color: #a96c20; }
.bsd-exclusions-list { margin: 8px 0 0; padding: 0; list-style: none; }
.bsd-exclusions-list:empty { display: none; }
.bsd-excluded-user { display: grid; grid-template-columns: 32px minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 9px 0; }
.bsd-excluded-user + .bsd-excluded-user { border-top: 1px solid var(--bsd-line); }
.bsd-excluded-user img { width: 32px; height: 32px; background: var(--bsd-soft); }
.bsd-excluded-user div { min-width: 0; }
.bsd-excluded-user strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.bsd-excluded-user small { display: block; overflow-wrap: anywhere; }
.bsd-excluded-user button { padding: 4px 0 4px 8px; border: 0; background: transparent; color: var(--bsd-pink); font-size: 11px; }
.bsd-excluded-user button:hover:not(:disabled) { text-decoration: underline; }
.bsd-mode-trigger { border: 1px solid var(--bsd-line); background: var(--bsd-bg); border-radius: 20px; padding: 6px 15px; font-size: 12px !important; }
.bsd-mode-options { position: fixed; z-index: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--bsd-pink) transparent; padding: 5px; box-sizing: border-box; border: 1px solid var(--bsd-line); border-radius: 16px; background: var(--bsd-bg); color: var(--bsd-fg); font: 12px/1.65 system-ui, sans-serif; text-align: center; }
.bsd-mode-options [role="option"] { padding: 8px; border-radius: 11px; cursor: pointer; }
.bsd-mode-options [role="option"]:hover, .bsd-mode-options [data-active="true"] { background: var(--bsd-soft); }
.bsd-mode-options [aria-selected="true"] { color: var(--bsd-pink); font-weight: 700; }
.bsd-mode-note { color: var(--bsd-muted); font-size: 11px; }
.bsd-results { position: relative; min-width: 0; min-height: 210px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px 0 10px; text-align: center; border-top: 1px solid var(--bsd-line); }
.bsd-results > [role="status"] { max-width: 100%; }
.bsd-status-label { color: var(--bsd-muted); font-size: 11px; }
.bsd-status-label::before { content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--bsd-pink); margin-right: 7px; vertical-align: middle; }
.bsd-message { font-size: 23px; font-weight: 650; line-height: 1.4; letter-spacing: -.04em; margin: 10px 0; overflow-wrap: anywhere; }
.bsd-hop-count { color: var(--bsd-pink); font-size: 44px; font-weight: 750; padding: 0 4px; }
.bsd-detail, .bsd-progress { color: var(--bsd-muted); font-size: 12px; margin: 7px 0; }
.bsd-detail:empty { display: none; }
.bsd-idle-mark { display: flex; align-items: center; gap: 24px; margin-bottom: 16px; position: relative; }
.bsd-idle-mark::before { content: ""; position: absolute; left: 10px; right: 10px; border-top: 1px dashed var(--bsd-pink); opacity: .35; }
.bsd-idle-mark i { width: 13px; height: 13px; border: 3px solid var(--bsd-bg); border-radius: 50%; background: var(--bsd-pink); position: relative; opacity: .6; }
.bsd-idle-mark i:nth-child(2) { width: 9px; height: 9px; }
.bsd-pulse { display: flex; gap: 11px; margin: 22px 0; }
.bsd-pulse i { width: 6px; height: 6px; border-radius: 50%; background: var(--bsd-pink); animation: bsd-pulse 1.6s infinite; }
.bsd-pulse i:nth-child(2) { animation-delay: .2s; }.bsd-pulse i:nth-child(3) { animation-delay: .4s; }
.bsd-output { width: 100%; min-width: 0; }
.bsd-path { position: relative; display: grid; align-items: start; gap: 40px 16px; width: 100%; margin: 6px auto 0; padding: 20px 16px 12px; }
.bsd-path-user { position: relative; display: flex; flex-direction: column; align-items: center; justify-self: center; width: 100%; max-width: 78px; min-width: 0; animation: bsd-appear .4s both; animation-delay: calc(var(--bsd-step) * 90ms); }
.bsd-path-user .bsd-avatar-link { border-radius: 18px; }
.bsd-path-lines { position: absolute; inset: 0; pointer-events: none; color: var(--bsd-pink); overflow: visible; }
.bsd-path-connection { pointer-events: stroke; animation: bsd-connect .4s both; animation-delay: calc(var(--bsd-step) * 90ms); }
.bsd-path-endpoint { margin-top: 5px; color: var(--bsd-pink); font-size: 10px; }
.bsd-path img { width: 52px; height: 52px; }
.bsd-path strong, .bsd-path small { display: block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.bsd-path strong { margin-top: 6px; font-size: 11px; }.bsd-path small { font-size: 10px; }
.bsd-egg { color: var(--bsd-muted); font-size: 11px; margin: 10px 0; }
.bsd-warning { color: #a96c20; font-size: 12px; margin: 10px 0; overflow-wrap: anywhere; }
.bsd-history { position: relative; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--bsd-line); }
.bsd-history header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.bsd-history h3 { margin: 0; color: var(--bsd-muted); font-size: 12px; font-weight: 600; }
.bsd-history [data-action="clear-history"] { padding: 4px 0 4px 8px; border: 0; background: transparent; color: var(--bsd-pink); font-size: 11px; }
.bsd-history [data-action="clear-history"]:hover { text-decoration: underline; }
.bsd-history-list { margin: 6px 0 0; padding: 0; list-style: none; }
.bsd-history-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; padding: 12px 0; }
.bsd-history-row + .bsd-history-row { border-top: 1px solid var(--bsd-line); }
.bsd-history-main { display: flex; flex-wrap: wrap; align-items: center; flex: 1 1 440px; min-width: 0; gap: 10px 20px; }
.bsd-history-pair { display: grid; grid-template-columns: fit-content(180px) 14px fit-content(180px); align-items: center; gap: 10px; width: fit-content; min-width: 0; max-width: 100%; }
.bsd-history-user { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 180px; }
.bsd-history-user a { flex: none; }
.bsd-history-user img { width: 32px; height: 32px; background: var(--bsd-soft); }
.bsd-history-user > div { min-width: 0; }
.bsd-history-user strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.bsd-history-user small { display: block; overflow-wrap: anywhere; }
.bsd-history-arrow { display: block; flex: none; width: 14px; height: 14px; color: var(--bsd-muted); }
.bsd-history-summary { display: flex; align-items: baseline; flex: none; gap: 6px; white-space: nowrap; }
.bsd-history-result { color: var(--bsd-fg); font-size: 12px; }
.bsd-history-hops { color: var(--bsd-pink); font-weight: 650; }
.bsd-history-mode, .bsd-history-meta { color: var(--bsd-muted); font-size: 11px; line-height: 1.65; }
.bsd-history-meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-left: auto; max-width: 100%; }
.bsd-history-meta time { overflow-wrap: anywhere; }
.bsd-footer { display: flex; align-items: center; justify-content: space-between; flex: none; gap: 16px; padding: 18px 28px; border-top: 1px solid var(--bsd-line); }
.bsd-hint { min-width: 0; color: var(--bsd-muted); font-size: 12px; overflow-wrap: anywhere; }
.bsd-actions { display: flex; flex: none; gap: 10px; }
.bsd-actions button { border: 1px solid var(--bsd-line); background: transparent; border-radius: 28px; padding: 9px 17px; box-shadow: none; }
.bsd-actions [data-action="explore"] { padding: 10px 25px; border: 0; background: linear-gradient(120deg, #dc728e, #eaa2ad); color: #fff; font-weight: 750; box-shadow: 0 6px 17px var(--bsd-shadow); }
.bsd-actions [data-action="explore"]:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 9px 22px var(--bsd-shadow); }
/* Keep fixed-position options viewport-relative, including during dialog entry. */
@keyframes bsd-open { from { opacity: 0; } to { opacity: 1; } }
@keyframes bsd-appear { from { opacity: 0; transform: translateY(12px) scale(.9); } to { opacity: 1; transform: none; } }
@keyframes bsd-connect { from { opacity: 0; } to { opacity: 1; } }
@keyframes bsd-pulse { 0%, 100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }
@keyframes bsd-shuffle { 25% { transform: rotate(-8deg); } 70% { transform: rotate(6deg); } }
[data-theme="dark"] .bsd-exclusions-toggle:hover { background: #ffffff0d; }
[data-theme="dark"] .bsd-overlay { --bsd-bg: #2b2831; --bsd-fg: #f2e9ef; --bsd-muted: #b6aab9; --bsd-soft: #36303c; --bsd-line: #4c404d; --bsd-pink: #f09bb2; --bsd-shadow: #0004; color-scheme: dark; }
@media (max-width: 600px) {
  .bsd-overlay { padding: 12px; }.bsd-dialog { max-height: 94dvh; border-radius: 21px; }
  .bsd-header { padding: 18px 20px 15px; }.bsd-header h2 { font-size: 20px; }
  .bsd-body { padding: 0 12px 5px; }.bsd-workspace { padding: 15px; }
  .bsd-top { grid-template-columns: minmax(0,1fr); gap: 7px; }
  .bsd-endpoint { padding: 9px 13px; grid-template-columns: 44px minmax(0,1fr); }.bsd-avatar { width: 44px; height: 44px; }.bsd-endpoint .bsd-avatar-link { border-radius: 14px; }
  .bsd-swap { justify-self: center; width: 27px; height: 27px; font-size: 16px !important; transform: rotate(90deg); }
  .bsd-mode { display: flex; flex-direction: column; gap: 9px; }.bsd-mode-choice { gap: 6px; }.bsd-mode-note { width: 100%; text-align: center; }
  .bsd-dialog .bsd-exclusions-toggle { align-self: flex-end; }
  .bsd-exclusions { padding: 12px; }.bsd-exclusions-entry { gap: 5px; }.bsd-exclusions-entry button { padding-inline: 9px; }
  .bsd-message { font-size: 20px; }.bsd-hop-count { font-size: 38px; }.bsd-detail, .bsd-progress { font-size: 11px; }
  .bsd-footer { padding: 14px 18px; flex-wrap: wrap; gap: 10px; }.bsd-hint { font-size: 10px; }.bsd-actions { margin-left: auto; }
  .bsd-actions [data-action="explore"] { padding: 10px 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .bsd-avatar-link[href]:hover img { transform: none; }
  .bsd-dialog, .bsd-dialog *, .bsd-dialog *::before, .bsd-dialog *::after { animation: none !important; transition: none !important; }
}
`;

export const styles = `
.bsd-launcher{position:fixed;right:25px;bottom:85px;z-index:9999;width:52px;height:52px;border:1px solid #f4bed0;border-radius:50%;background:#fff9fc;color:#f091a8;box-shadow:0 3px 14px #0002;cursor:pointer;transition:transform .2s,box-shadow .2s}
.bsd-launcher:hover{transform:translateY(-3px) rotate(-8deg);box-shadow:0 5px 18px #f091a855}.bsd-launcher svg{width:34px;height:34px}
.bsd-overlay{--bsd-bg:#fff;--bsd-fg:#555;--bsd-soft:#f8f5f6;--bsd-line:#e8dfe3;position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:#0005;box-sizing:border-box}
.bsd-overlay[hidden],.bsd-dialog[hidden]{display:none!important}
.bsd-dialog{color:var(--bsd-fg);background:var(--bsd-bg);border:1px solid var(--bsd-line);border-radius:16px;box-shadow:0 16px 65px #0004;width:min(850px,100%);max-height:90dvh;min-height:430px;display:flex;flex-direction:column;font:14px/1.6 Arial,sans-serif;overflow:hidden;text-align:left}
.bsd-dialog *{box-sizing:border-box}.bsd-dialog button,.bsd-dialog input,.bsd-dialog select{font:inherit;color:inherit}
.bsd-dialog button{cursor:pointer}.bsd-dialog button:disabled{cursor:default;opacity:.5}
.bsd-dialog :focus-visible,.bsd-launcher:focus-visible{outline:2px solid #f091a8;outline-offset:3px}
.bsd-header{display:flex;align-items:center;justify-content:space-between;padding:17px 22px;border-bottom:1px solid var(--bsd-line)}.bsd-header h2{font-size:20px;margin:0;color:var(--bsd-fg)}.bsd-header small{opacity:.65}
.bsd-close{border:0;background:none;font-size:25px!important;padding:0 8px}
.bsd-body{padding:22px;overflow:auto;overscroll-behavior:contain;flex:1}
.bsd-top{display:grid;grid-template-columns:minmax(0,1fr) 130px minmax(0,1fr);align-items:center;gap:14px}
.bsd-endpoint{display:grid;grid-template-columns:48px minmax(0,1fr);gap:10px;align-items:start}
.bsd-avatar{width:48px;height:48px;border-radius:8px;object-fit:cover;background:var(--bsd-soft)}
.bsd-input{display:flex;align-items:center;gap:4px;border-bottom:2px solid var(--bsd-line)}.bsd-input input{min-width:0;width:100%;border:0;background:none;padding:5px 0;outline-offset:0}
.bsd-shortcuts{display:flex;gap:9px;margin-top:4px}.bsd-shortcuts button,.bsd-swap{border:0;background:none;color:#d57c96!important;font-size:12px!important;padding:2px 0}
.bsd-error{display:block;color:#c75a70;min-height:1.3em;font-size:11px}.bsd-bridge{text-align:center}.bsd-bridge select{width:100%;border:1px solid var(--bsd-line);background:var(--bsd-soft);border-radius:15px;padding:4px}
.bsd-arrow{display:block;color:#f091a8;font-size:30px;line-height:1.2}.bsd-swap-row{text-align:center;margin:5px 0 16px}
.bsd-results{min-height:155px;display:flex;flex-direction:column;justify-content:center;text-align:center;border-radius:12px;background:var(--bsd-soft);padding:18px}
.bsd-message{margin:5px 0}.bsd-progress,.bsd-warning,.bsd-stale{font-size:12px;opacity:.75}.bsd-warning{color:#bf7c29}.bsd-stale{color:#bf7c29;margin-bottom:12px}
.bsd-path{display:flex;align-items:center;gap:14px;overflow-x:auto;padding:12px 4px;text-align:center}
.bsd-path a{display:flex;flex-direction:column;align-items:center;flex:0 0 94px;max-width:110px;color:var(--bsd-fg);text-decoration:none;animation:bsd-appear .25s ease-out}
.bsd-path img{width:56px;height:56px;border-radius:12px;object-fit:cover}.bsd-path strong,.bsd-path small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bsd-path small{font-size:11px;opacity:.7}
.bsd-path .bsd-link{color:#f091a8;font-size:24px;flex:none}.bsd-egg{color:#d57c96;font-size:12px}
.bsd-footer{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid var(--bsd-line)}
.bsd-footer button{border-radius:18px;border:1px solid var(--bsd-line);padding:6px 22px;background:var(--bsd-soft)}
.bsd-footer [data-action="explore"]{background:#f091a8;border-color:#f091a8;color:white}.bsd-footer [hidden]{display:none}
@keyframes bsd-appear{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
[data-theme="dark"] .bsd-overlay{--bsd-bg:#29282d;--bsd-fg:#ddd;--bsd-soft:#333138;--bsd-line:#49424c}[data-theme="dark"] .bsd-launcher{background:#333138;border-color:#62505c}
@media(max-width:600px){.bsd-launcher{right:18px;bottom:72px}.bsd-overlay{padding:12px}.bsd-dialog{max-height:94dvh;min-height:0}.bsd-body{padding:16px}.bsd-top{grid-template-columns:1fr}.bsd-bridge{display:flex;align-items:center;justify-content:center;gap:15px}.bsd-bridge select{width:145px}.bsd-arrow{transform:rotate(90deg);font-size:26px}.bsd-header{padding:12px 16px}.bsd-header small{display:none}.bsd-footer{padding:12px 16px}.bsd-results{min-height:130px}}
@media(prefers-reduced-motion:reduce){.bsd-launcher,.bsd-path a{transition:none;animation:none}}
`;

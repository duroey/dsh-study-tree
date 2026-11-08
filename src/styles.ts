import { CONFIG } from './config.ts';

/** Quiet navigation and source geometry; normal session typography stays with DSH. */
const STYLES = `
[data-study-inherited="true"] { display: none !important; }
html.dsh-study-tree-selection [data-text-interaction-surface] { visibility: hidden !important; pointer-events: none !important; }
.dsh-study-ui {
  --study-paper: var(--dsw-alias-bg-base, #ffffff);
  --study-panel: var(--dsw-specific-sidebar-fill, #f6f8fb);
  --study-ink: var(--dsw-alias-label-primary, #17202b);
  --study-muted: var(--dsw-alias-label-secondary, #6c7788);
  --study-line: var(--dsw-alias-border-l3, #dde3eb);
  --study-accent: var(--dsw-alias-state-business-primary, #2358cc);
  --study-tint: #e8eefb;
  --study-hover: var(--dsw-alias-interactive-bg-hover, #edf0f5);
  --study-danger: #b34242;
  box-sizing: border-box; color: var(--study-ink); font: inherit;
  font-size: 13px; line-height: 1.5; text-align: left; pointer-events: auto;
}
[data-ds-dark-theme] .dsh-study-ui { --study-tint: #23344f; --study-danger: #ed9696; }
.dsh-study-ui *, .dsh-study-ui *::before, .dsh-study-ui *::after { box-sizing: border-box; }
.dsh-study-ui button, .dsh-study-ui input, .dsh-study-ui textarea, .dsh-study-ui select { font: inherit; }
.dsh-study-ui button { color: inherit; cursor: pointer; }
.dsh-study-ui button:disabled { opacity: .45; cursor: default; }
.dsh-study-ui button:focus-visible, .dsh-study-ui input:focus-visible, .dsh-study-ui select:focus-visible,
.dsh-study-ui textarea:focus-visible, .study-tree-row:focus-visible { outline: 2px solid var(--study-accent); outline-offset: 2px; }
.study-icon { display: block; flex: 0 0 auto; }
.study-icon-button { width: 28px; height: 28px; padding: 5px; border: 0; background: transparent; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; }
.study-icon-button:hover:not(:disabled) { background: var(--study-hover); }
.study-navigation { position: fixed; z-index: 100; inset: 0 auto 0 0; width: ${CONFIG.treeWidth}px; height: 100dvh; background: var(--study-panel); border-right: 1px solid var(--study-line); display: flex; flex-direction: column; min-height: 0; transform: translateX(-100%); visibility: hidden; pointer-events: none; transition: transform ${CONFIG.drawerMotionDurationMs}ms ${CONFIG.drawerMotionEasing}, visibility 0s linear ${CONFIG.drawerMotionDurationMs}ms; }
.study-navigation[data-study-open="true"] { transform: translateX(0); visibility: visible; pointer-events: auto; transition-delay: 0s; }
.study-navigation-header { min-height: 64px; padding: 18px 12px 15px 19px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.study-navigation-title { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; letter-spacing: .01em; }
.study-navigation-title > svg { color: var(--study-accent); width: 20px; height: 20px; }
.study-navigation-header > button { color: var(--study-muted); }
.study-new-branch { display: flex; align-items: center; gap: 7px; margin: 0 15px 12px; padding: 8px 10px; min-height: 35px; border: 1px solid var(--study-line); border-radius: 7px; background: var(--study-paper); text-align: left; flex: 0 0 auto; }
.study-new-branch:hover:not(:disabled) { border-color: var(--study-accent); color: var(--study-accent); }
.study-new-branch svg { width: 16px; height: 16px; color: var(--study-accent); }
.study-new-branch small { margin-left: auto; font-size: 10px; color: var(--study-muted); }
.study-tree-heading { min-height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px 0 20px; color: var(--study-muted); font-size: 11px; }
.study-management { position: relative; flex: 0 0 auto; }
.study-management > button .study-icon { width: 15px; height: 15px; }
.study-management-menu { position: absolute; z-index: 1; right: 0; top: calc(100% + 3px); min-width: 174px; padding: 5px; border: 1px solid var(--study-line); border-radius: 8px; background: var(--study-paper); box-shadow: 0 6px 24px #1824361c; }
.study-management-menu > button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 9px; border: 0; border-radius: 4px; background: none; text-align: left; white-space: nowrap; font-size: 12px !important; }
.study-management-menu > button:hover, .study-management-menu > button:focus-visible { background: var(--study-hover); }
.study-management-menu .study-icon { width: 15px; height: 15px; color: var(--study-muted); }
.study-tree-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 9px 20px; scrollbar-width: thin; }
.study-recovery { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; margin: 3px 3px 14px; padding: 11px; border: 1px solid var(--study-line); border-radius: 7px; background: var(--study-paper); }
.study-recovery p { margin: 0; font-size: 12px; font-weight: 550; }
.study-recovery > span { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--study-muted); font-size: 11px; }
.study-recovery > button { margin-top: 3px; }
.study-tree-list { display: flex; flex-direction: column; gap: 3px; }
.study-tree-entry { display: contents; }
.study-draft-row { font-style: italic; }
.study-draft-row .study-tree-leaf svg { width: 12px; height: 12px; }
.study-draft-page { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--study-paper); }
.study-legacy-draft { position: fixed; z-index: 90; top: 0; right: 0; bottom: 0; left: ${CONFIG.treeWidth}px; pointer-events: auto; }
.study-draft-header { min-height: 64px; padding: 16px 28px; display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--study-line); }
.study-draft-header-actions { display: flex; align-items: center; gap: 16px; }
.study-draft-header strong { font-size: 14px; font-weight: 550; }
.study-draft-intro { flex: 1; min-height: 0; overflow: auto; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 40px 28px; text-align: center; }
.study-draft-intro > svg { width: 28px; height: 28px; color: var(--study-accent); margin-bottom: 18px; }
.study-draft-intro h1 { font-size: 20px; line-height: 1.6; font-weight: 550; max-width: 36em; margin: 0 0 10px; overflow-wrap: anywhere; }
.study-draft-intro p { margin: 0; color: var(--study-muted); }
.study-draft-composer { width: min(880px, calc(100% - 48px)); margin: 0 auto 32px; border: 1px solid var(--study-line); border-radius: 15px; background: var(--study-paper); box-shadow: 0 2px 14px #17202b08; }
.study-draft-composer:focus-within { border-color: color-mix(in srgb, var(--study-accent) 45%, var(--study-line)); }
.study-draft-composer textarea { width: 100%; display: block; border: 0; outline: 0 !important; background: transparent; color: var(--study-ink); padding: 16px 17px 10px; min-height: 85px; max-height: 240px; resize: vertical; line-height: 1.7; }
.study-draft-composer textarea::placeholder { color: var(--study-muted); }
.study-draft-composer-footer { padding: 0 11px 11px 17px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.study-draft-composer-footer > span { font-size: 11px; color: var(--study-muted); }
.study-tree-row { display: flex; position: relative; align-items: center; min-height: 35px; padding: 3px 5px 3px 6px; border-radius: 6px; cursor: pointer; outline-offset: -2px; }
.study-tree-row:hover { background: var(--study-hover); }
.study-tree-row.is-active { background: var(--study-tint); color: var(--study-accent); }
.study-tree-row.is-topic { margin-top: 12px; font-weight: 550; }
.study-tree-row.is-topic:first-child { margin-top: 0; }
.study-tree-entry:not(:first-child) > .study-tree-row.is-topic { margin-top: 12px; }
.study-tree-row[data-study-node-id] { user-select: none; -webkit-user-select: none; }
.study-drag-handle { display: flex; align-items: center; justify-content: center; width: 18px; height: 29px; flex: 0 0 18px; margin-left: -3px; color: var(--study-muted); opacity: .28; cursor: grab; user-select: none; touch-action: none; }
.study-drag-handle > svg { width: 12px; height: 17px; }
.study-tree-row:hover .study-drag-handle, .study-tree-row:focus-within .study-drag-handle { opacity: .75; }
.study-navigation[data-study-sorting="true"], .study-navigation[data-study-sorting="true"] * { cursor: grabbing; }
.study-tree-row[data-study-dragging="true"] { opacity: .45; }
.study-tree-row[data-study-drop="before"]::after, .study-tree-row[data-study-drop="after"]::after { content: ''; position: absolute; left: calc(23px + var(--study-drop-depth, 0) * 17px); right: 4px; height: 2px; border-radius: 2px; background: var(--study-accent); pointer-events: none; }
.study-tree-row[data-study-drop="before"]::after { top: -2px; }
.study-tree-row[data-study-drop="after"]::after { bottom: -2px; }
.study-drag-preview { position: fixed; z-index: 3; top: 0; left: 0; display: flex; align-items: center; gap: 7px; max-width: 250px; padding: 7px 11px; border: 1px solid var(--study-line); border-radius: 7px; background: var(--study-paper); box-shadow: 0 5px 18px #17202b25; color: var(--study-ink); pointer-events: none; font-size: 12px; }
.study-drag-preview > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.study-drag-preview > svg { width: 12px; height: 17px; color: var(--study-muted); }
.study-drag-status { flex: 0 0 35px; height: 35px; padding: 8px 19px; font-size: 11px; color: var(--study-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.study-sr-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.study-node-kind { flex: 0 0 auto; padding: 1px 4px; margin-left: 5px; border: 1px solid var(--study-line); border-radius: 4px; color: var(--study-muted); font-size: 10px; font-weight: 400; line-height: 1.4; }
.study-tree-indent { height: 35px; flex: 0 0 auto; display: inline-flex; align-self: stretch; margin: -3px 0; }
.study-tree-indent > i { width: 17px; height: 100%; position: relative; display: block; }
.study-tree-indent > i::before { content: ''; position: absolute; left: 9px; top: 0; bottom: 0; border-left: 1px solid var(--study-line); }
.study-tree-row.is-active .study-tree-indent > i::before { border-color: color-mix(in srgb, var(--study-accent) 22%, transparent); }
.study-tree-chevron, .study-tree-leaf { flex: 0 0 21px; width: 21px; height: 25px; display: inline-flex; align-items: center; justify-content: center; padding: 0; background: none; border: 0; color: var(--study-muted); }
.study-tree-chevron svg { width: 13px; height: 13px; }
.study-tree-chevron.is-open svg { transform: rotate(90deg); }
.study-tree-leaf i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .65; }
.study-tree-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 3px; }
.study-tree-row.is-active .study-tree-label { font-weight: 550; }
.study-node-menu { opacity: 0; flex: 0 0 auto; width: 25px; height: 25px; padding: 5px; margin-left: 3px; color: var(--study-muted); }
.study-node-menu > svg { width: 16px; height: 16px; }
.study-tree-row:hover .study-node-menu, .study-tree-row:focus-within .study-node-menu { opacity: 1; }
.study-running { width: 6px; height: 6px; margin-left: 5px; border-radius: 50%; background: var(--study-accent); flex: 0 0 auto; }
.study-add-current { display: flex; align-items: center; gap: 7px; margin: 16px 5px 0; padding: 7px 1px; text-align: left; border: 0; background: none; color: var(--study-muted) !important; font-size: 11px !important; }
.study-add-current svg { width: 14px; height: 14px; }
.study-add-current:hover { color: var(--study-accent) !important; }
.study-navigation-footer { flex: 0 0 auto; padding: 18px 19px 20px; border-top: 1px solid var(--study-line); }
.study-source-caption { font-size: 11px; color: var(--study-muted); margin-bottom: 8px; }
.study-origin-title { margin: 0 0 12px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.study-source-quote { margin: 0 0 13px; padding: 0 0 0 9px; border-left: 2px solid var(--study-line); font-size: 12px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.study-source-return { display: flex; align-items: center; gap: 7px; padding: 0; border: 0; background: none; color: var(--study-accent) !important; font-size: 12px !important; }
.study-source-return svg { width: 15px; height: 15px; }
.study-history-toggle { display: flex; align-items: center; gap: 7px; width: 100%; margin-top: 18px; padding: 10px 0 0; border: 0; border-top: 1px solid var(--study-line); background: none; color: var(--study-muted) !important; font-size: 11px !important; text-align: left; }
.study-history-toggle > svg { width: 14px; height: 14px; }
.study-history-toggle > svg:last-child { margin-left: auto; width: 12px; height: 12px; }
.study-history-toggle.is-active > svg:last-child { transform: rotate(90deg); }
.study-navigation-hint { margin: 0; color: var(--study-muted); font-size: 12px; line-height: 1.85; }
.study-empty { padding: 27px 11px; }
.study-empty-title { margin: 0 0 8px; font-size: 14px; font-weight: 550; }
.study-empty-copy { color: var(--study-muted); margin: 0 0 18px; font-size: 12px; line-height: 1.8; }
.study-empty .study-button { width: 100%; }
.study-empty .study-text-button { width: 100%; margin-top: 10px; text-align: center; }
.study-tree-scrim { display: none; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity ${CONFIG.drawerMotionDurationMs}ms ${CONFIG.drawerMotionEasing}, visibility 0s linear ${CONFIG.drawerMotionDurationMs}ms; }
.study-tree-scrim[data-study-open="true"] { opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s; }
.study-header-toggle { display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; min-height: 29px; border: 1px solid transparent; background: transparent; border-radius: 6px; font-size: 12px; }
.study-header-toggle > svg { width: 15px; height: 15px; }
.study-header-toggle:hover { background: var(--study-hover); }
.study-header-toggle.is-active { color: var(--study-accent); background: var(--study-tint); }
.study-lineage { display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
.study-lineage-part { min-width: 0; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 1; }
.study-lineage-part > svg { width: 11px; height: 11px; color: var(--study-muted); }
.study-lineage-part > button, .study-lineage-current { display: block; min-width: 0; max-width: 155px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.study-lineage-part > button { padding: 3px 1px; border: 0; background: none; color: var(--study-muted); font-size: 13px; }
.study-lineage-part > button:hover { color: var(--study-accent); }
.study-lineage-current { color: var(--study-ink); font-weight: 550; }
.study-legacy-selection { position: fixed; z-index: 160; max-width: calc(100vw - 16px); }
.study-selection-action { display: flex; align-items: center; gap: 4px; width: max-content; max-width: 100%; padding: 5px; background: var(--study-paper); border: 1px solid var(--study-line); border-radius: 9px; box-shadow: 0 4px 18px #18243616; }
.study-selection-expand { display: inline-flex; align-items: center; gap: 7px; padding: 5px 8px; border: 0; border-radius: 5px; background: none; color: var(--study-accent) !important; font-weight: 550 !important; white-space: nowrap; }
.study-selection-expand:hover { background: var(--study-tint); }
.study-selection-expand > svg { width: 16px; height: 16px; }
.study-fork-form { width: 360px; max-width: calc(100vw - 24px); padding: 15px; background: var(--study-paper); border: 1px solid var(--study-line); border-radius: 10px; box-shadow: 0 9px 30px #18243620; }
.study-form-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 600; margin: -3px -4px 9px 0; }
.study-form-heading > span { display: inline-flex; align-items: center; gap: 7px; }
.study-form-heading > span > svg { width: 16px; height: 16px; color: var(--study-accent); }
.study-fork-quote { margin: 0 0 14px; padding-left: 9px; border-left: 2px solid var(--study-line); color: var(--study-muted); font-size: 12px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.study-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 13px; }
.study-field > span { color: var(--study-muted); font-size: 12px; }
.study-field input, .study-field textarea, .study-field select { display: block; width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--study-line); border-radius: 6px; background: var(--study-paper); color: var(--study-ink); font-size: 13px; line-height: 1.55; }
.study-field textarea { resize: vertical; min-height: 86px; max-height: 210px; }
.study-field textarea::placeholder { color: var(--study-muted); opacity: .75; }
.study-form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 17px; }
.study-button { min-height: 32px; padding: 6px 12px; border: 1px solid var(--study-line); border-radius: 6px; background: var(--study-paper); font-size: 12px !important; font-weight: 500 !important; }
.study-button:hover:not(:disabled) { background: var(--study-hover); }
.study-button-primary { background: var(--study-accent); border-color: var(--study-accent); color: white !important; }
.study-button-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--study-accent) 90%, black); }
.study-text-button { padding: 6px 0; border: 0; background: none; color: var(--study-muted) !important; font-size: 12px !important; text-align: left; }
.study-text-button:hover:not(:disabled) { color: var(--study-accent) !important; }
.study-modal-scrim { position: fixed; z-index: 200; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: #101a2b38; }
.study-dialog { width: 400px; max-width: 100%; max-height: calc(100dvh - 48px); overflow: auto; padding: 22px; border: 1px solid var(--study-line); border-radius: 12px; background: var(--study-paper); box-shadow: 0 18px 70px #111a2930; }
.study-dialog-heading { display: flex; align-items: center; justify-content: space-between; margin: -3px -4px 19px 0; gap: 12px; }
.study-dialog-heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
.study-dialog-description { margin: -4px 0 18px; color: var(--study-muted); font-size: 12px; line-height: 1.8; }
.study-detach-area { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--study-line); }
.study-detach { color: var(--study-danger) !important; padding: 0; }
.study-detach-area p { margin: 7px 0 0; color: var(--study-muted); font-size: 11px; line-height: 1.7; }
.study-error { position: fixed; z-index: 220; bottom: 22px; left: 50%; transform: translateX(-50%); display: flex; align-items: flex-start; gap: 14px; width: max-content; max-width: min(560px, calc(100vw - 32px)); padding: 12px 12px 12px 16px; border: 1px solid var(--study-line); border-radius: 9px; background: var(--study-paper); box-shadow: 0 6px 22px #18243622; font-size: 12px; }
.study-error > span { padding-top: 4px; overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: ${CONFIG.narrowWidth - 1}px) {
  .study-legacy-draft { left: 0; }
  .study-navigation { width: min(${CONFIG.treeWidth}px, 86vw); }
  .study-tree-scrim { display: block; position: fixed; z-index: 99; inset: 0; width: 100vw; height: 100dvh; border: 0; background: #101a2b38; }
  .study-node-menu { opacity: 1; }
  .study-lineage-part > button, .study-lineage-current { max-width: 95px; }
  .study-fork-form { width: min(360px, calc(100vw - 24px)); }
}
@media (prefers-reduced-motion: reduce) {
  .study-navigation, .study-tree-scrim { transition: none; }
}
@media (pointer: coarse) {
  .study-drag-handle { opacity: .65; }
}
`;

/**
 * Installs this plugin's scoped styles without changing host theme settings.
 *
 * Returns:
 *   An idempotent disposer for the style element owned by this plugin instance.
 */
export function installStyles(): () => void {
  const style = document.createElement('style');
  style.dataset.studyTreeStyles = '';
  style.textContent = STYLES;
  document.head.appendChild(style);
  return () => style.remove();
}

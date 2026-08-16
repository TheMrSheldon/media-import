<script lang="ts">
  export let existingPath: string;
  export let suggestedPath: string | undefined = undefined;
  export let onContinue: () => void;
  export let onCancel: () => void;
</script>

<div class="conflict-box">
  <p class="conflict-msg">Already exists in library:</p>
  <p class="conflict-path">{existingPath}</p>
  {#if suggestedPath}
    <p class="conflict-msg">It will instead be saved as:</p>
    <p class="conflict-path">{suggestedPath}</p>
  {/if}
  <div class="conflict-actions">
    <button class="btn-primary conflict-continue" on:click={onContinue}>Continue (will save as different name)</button>
    <button class="btn-secondary" on:click={onCancel}>Cancel</button>
  </div>
</div>

<style>
  .conflict-box {
    padding: 0.65rem 0.75rem;
    border: 1px solid #f87171;
    border-left: 3px solid #ef4444;
    border-radius: 6px;
    background: rgba(239,68,68,0.06);
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .conflict-msg { margin: 0; font-size: 0.78rem; font-weight: 700; color: #dc2626; }
  .conflict-path { margin: 0 0 0.15rem; font-size: 0.75rem; font-family: ui-monospace, 'Cascadia Code', monospace; color: var(--text); word-break: break-all; }
  .conflict-actions { display: flex; gap: 0.5rem; margin-top: 0.2rem; }
  .conflict-continue { background: #dc2626; }
  .conflict-continue:hover { background: #b91c1c; }
</style>

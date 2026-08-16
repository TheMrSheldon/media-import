<script lang="ts">
  import type { UploadDestination, ExtraType, ExtraFile } from '../api.js';

  export let destinationId: string | null = null;
  export let destinations: UploadDestination[] = [];
  export let transcode: boolean = false;
  export let extras: ExtraFile[] = [];
  export let mediaType: 'movie' | 'series' = 'movie';
  export let onExtraAdded: () => void = () => {};

  const EXTRA_TYPES: { value: ExtraType; label: string }[] = [
    { value: 'trailer', label: 'Trailer' },
    { value: 'behindthescenes', label: 'Behind the Scenes' },
    { value: 'deleted', label: 'Deleted Scene' },
    { value: 'interview', label: 'Interview' },
    { value: 'scene', label: 'Scene' },
    { value: 'short', label: 'Short' },
    { value: 'featurette', label: 'Featurette' },
    { value: 'other', label: 'Other' },
  ];

  function addExtra() {
    extras = [...extras, { file: null as unknown as File, type: 'trailer' }];
    onExtraAdded();
  }

  function removeExtra(i: number) {
    extras = extras.filter((_, idx) => idx !== i);
  }

  function handleExtraFile(i: number, e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    extras = extras.map((ex, idx) => (idx === i ? { ...ex, file } : ex));
  }
</script>

<div class="upload-options">
  <div class="field">
    <label for="upload-dest">Destination *</label>
    <select id="upload-dest" class="input" bind:value={destinationId}>
      <option value={null} disabled selected>Choose a folder…</option>
      {#each destinations as d}
        <option value={d.id}>{d.label}</option>
      {/each}
    </select>
  </div>

  <label class="checkbox-row">
    <input type="checkbox" bind:checked={transcode} />
    Transcode after upload
  </label>

  {#if mediaType === 'movie'}
    <div class="extras">
      <div class="extras-header">
        <span class="extras-label">Extras</span>
        <button type="button" class="btn-secondary btn-add-extra" on:click={addExtra}>+ Add extra</button>
      </div>
      {#each extras as extra, i}
        <div class="extra-row">
          <label class="file-input-label extra-file">
            <input type="file" accept="video/*" on:change={(e) => handleExtraFile(i, e)} class="file-input" />
            <span class="file-input-text">{extra.file?.name ?? 'Choose a file…'}</span>
          </label>
          <select class="input extra-type" bind:value={extra.type}>
            {#each EXTRA_TYPES as t}
              <option value={t.value}>{t.label}</option>
            {/each}
          </select>
          <button type="button" class="del-btn" on:click={() => removeExtra(i)} title="Remove">✕</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .upload-options { display: flex; flex-direction: column; gap: 0.6rem; }
  .field { display: flex; flex-direction: column; gap: 0.25rem; }
  label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
  .input {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
    font-size: 0.9rem;
    width: 100%;
    box-sizing: border-box;
  }
  .checkbox-row {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.85rem; font-weight: 500; color: var(--text);
    cursor: pointer;
  }
  .checkbox-row input { cursor: pointer; }

  .extras { display: flex; flex-direction: column; gap: 0.5rem; }
  .extras-header { display: flex; justify-content: space-between; align-items: center; }
  .extras-label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
  .btn-add-extra { font-size: 0.78rem; padding: 0.3rem 0.65rem; }

  .extra-row { display: flex; align-items: center; gap: 0.4rem; }
  .extra-file { flex: 1; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-input); }
  .extra-type { flex: 0 0 auto; width: auto; }
  .file-input-label { display: flex; align-items: center; padding: 0.45rem 0.7rem; cursor: pointer; min-width: 0; }
  .file-input { display: none; }
  .file-input-text { font-size: 0.85rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .del-btn {
    background: none; border: none; color: var(--text-muted);
    font-size: 0.8rem; padding: 0.2rem 0.4rem; border-radius: 4px;
    cursor: pointer; transition: color 0.15s;
  }
  .del-btn:hover { color: var(--error); }
</style>

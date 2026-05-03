<script lang="ts">
  export let videoUrl: string;
  export let onUrlChange: (url: string) => void;

  function handle(e: Event) {
    onUrlChange((e.target as HTMLInputElement).value.trim());
  }
</script>

<div class="panel">
  <label class="label" for="url-input">Video URL</label>
  <input
    id="url-input"
    class="input"
    type="url"
    value={videoUrl}
    on:input={handle}
    placeholder="https://example.com/video.mp4"
  />
  <p class="hint">Paste a direct link to an .mp4, .mkv, or other video file.</p>
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 0.4rem; }
  .label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
  .input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
    font-size: 0.95rem;
  }
  .hint { font-size: 0.8rem; color: var(--text-muted); margin: 0; }
</style>

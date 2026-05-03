<script lang="ts">
  export let mediaType: 'movie' | 'series' = 'movie';
  export let title: string = '';
  export let year: number | '' = '';
  export let seriesTitle: string = '';
  export let season: number | '' = '';
  export let episode: number | '' = '';
  export let episodeTitle: string = '';
</script>

<div class="form">
  <!-- Media type toggle -->
  <div class="toggle-row">
    <button
      class="toggle-btn"
      class:active={mediaType === 'movie'}
      on:click={() => { mediaType = 'movie'; }}
    >
      Movie
    </button>
    <button
      class="toggle-btn"
      class:active={mediaType === 'series'}
      on:click={() => { mediaType = 'series'; }}
    >
      TV Series
    </button>
  </div>

  {#if mediaType === 'movie'}
    <div class="row">
      <div class="field">
        <label for="movie-title">Title *</label>
        <input id="movie-title" class="input" bind:value={title} placeholder="Movie title" />
      </div>
      <div class="field field-narrow">
        <label for="movie-year">Year *</label>
        <input id="movie-year" class="input" type="number" bind:value={year} placeholder="2024" min="1900" max="2099" />
      </div>
    </div>
  {:else}
    <div class="row">
      <div class="field">
        <label for="series-title">Series Title *</label>
        <input id="series-title" class="input" bind:value={seriesTitle} placeholder="Series name" />
      </div>
      <div class="field field-narrow">
        <label for="series-year">Year *</label>
        <input id="series-year" class="input" type="number" bind:value={year} placeholder="2024" min="1900" max="2099" />
      </div>
    </div>
    <div class="row">
      <div class="field field-narrow">
        <label for="season">Season *</label>
        <input id="season" class="input" type="number" bind:value={season} placeholder="1" min="1" />
      </div>
      <div class="field field-narrow">
        <label for="episode">Episode *</label>
        <input id="episode" class="input" type="number" bind:value={episode} placeholder="1" min="1" />
      </div>
      <div class="field">
        <label for="ep-title">Episode Title</label>
        <input id="ep-title" class="input" bind:value={episodeTitle} placeholder="Optional episode title" />
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="ep-imdb-title">IMDB Search Title</label>
        <input id="ep-imdb-title" class="input" bind:value={title} placeholder="Title used for IMDB search (series name)" />
      </div>
    </div>
  {/if}
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 0.6rem; }
  .toggle-row { display: flex; gap: 0; border: 1px solid var(--border); border-radius: 6px; width: fit-content; overflow: hidden; }
  .toggle-btn {
    padding: 0.4rem 1.1rem;
    border: none;
    background: var(--bg-input);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: background 0.15s, color 0.15s;
  }
  .toggle-btn.active { background: var(--accent); color: #fff; }
  .row { display: flex; gap: 0.6rem; }
  .field { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
  .field-narrow { max-width: 100px; flex: 0 0 100px; }
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
</style>

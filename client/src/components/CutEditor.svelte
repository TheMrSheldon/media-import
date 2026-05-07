<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import {
    listUncutFiles, startCutImport, uncutStreamUrl, getUncutDuration,
    searchImdb, formatBytes, formatDate, frameUrl, ConflictError,
    type ImdbResult, type CutSegment, type UncutFile,
  } from '../api.js';
  import ImdbSelector from './ImdbSelector.svelte';
  import MediaForm from './MediaForm.svelte';

  const dispatch = createEventDispatcher<{ job: { jobId: string } }>();

  // File list
  let files: UncutFile[] = [];
  let filesError = '';
  let selectedFile: string | null = null;
  let imdbData = new Map<string, ImdbResult>();
  let sortBy: 'mtime' | 'name' = 'mtime';

  function extractImdbId(name: string): string | null {
    const m = name.match(/\[imdbid-(tt\d+)\]/i);
    return m ? m[1] : null;
  }

  $: sortedFiles = [...files].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return b.mtime - a.mtime; // newest first
  });

  // Video player
  let videoEl: HTMLVideoElement;
  let timelineEl: HTMLDivElement;
  let streamStart = 0;
  let shouldAutoPlay = false;
  let fps = 25;            // default PAL; covers virtually all European broadcast
  let videoDuration = 0;
  let currentTime = 0;
  let bufferedEnd = 0;
  let playing = false;
  let muted = false;
  let videoLoaded = false;
  let videoError = '';

  // Editor state
  let markers: number[] = [];   // sorted absolute timestamps; alternating cut/keep boundaries
  let showMetadata = false;

  // Filmstrip preview
  let filmstripN = 5;
  let filmstripTime = 0;
  let bridgeFrameUrl: string | null = null;  // shown while stream reloads to avoid flash of "Loading…"
  $: filmstripOffsets = Array.from({ length: 2 * filmstripN + 1 }, (_, i) => i - filmstripN);

  // IMDB + metadata
  let imdbQuery = '';
  let selectedImdb: ImdbResult | null = null;
  let title = '';
  let year: number | '' = '';
  let mediaType: 'movie' | 'series' = 'movie';
  let seriesTitle = '';
  let season: number | '' = '';
  let episode: number | '' = '';
  let episodeTitle = '';
  let submitting = false;
  let submitError = '';
  let conflictPath: string | null = null;

  $: imdbQuery = title;

  onMount(async () => {
    try {
      files = await listUncutFiles();
      loadImdbData(files);
    }
    catch (e: any) { filesError = e.message ?? 'Failed to load files'; }
    document.addEventListener('keydown', handleKeydown);
  });

  async function loadImdbData(fileList: UncutFile[]) {
    const ids = [...new Set(fileList.map(f => extractImdbId(f.name)).filter(Boolean) as string[])];
    await Promise.all(ids.map(async (id) => {
      try {
        const results = await searchImdb(id);
        const match = results.find(r => r.imdbId === id) ?? results[0];
        if (match) imdbData = new Map(imdbData).set(id, match);
      } catch { /* ignore */ }
    }));
  }

  onDestroy(() => { document.removeEventListener('keydown', handleKeydown); });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showMetadata) { showMetadata = false; return; }
      if (selectedFile)  { closeEditor(); return; }
    }
    if (!videoLoaded) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ')          { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); skip(-5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); skip(10); }
    if (e.key === ',')          { e.preventDefault(); stepFrame(-1); }
    if (e.key === '.')          { e.preventDefault(); stepFrame(1); }
    if (e.key === 'm' || e.key === 'M') { e.preventDefault(); addMarker(); }
  }

  async function selectFile(f: UncutFile) {
    selectedFile = f.name;
    streamStart = 0;
    shouldAutoPlay = false;
    videoLoaded = false;
    videoError = '';
    videoDuration = 0;
    currentTime = 0;
    bufferedEnd = 0;
    playing = false;
    markers = [];
    filmstripTime = 0;
    bridgeFrameUrl = null;
    showMetadata = false;

    // Pre-fill metadata from IMDB data embedded in filename
    const imdbId = extractImdbId(f.name);
    if (imdbId) {
      const imdb = imdbData.get(imdbId);
      if (imdb) handleImdbSelect(imdb);
    } else {
      selectedImdb = null;
      title = '';
      year = '';
      seriesTitle = '';
      season = '';
      episode = '';
      episodeTitle = '';
    }

    try { videoDuration = await getUncutDuration(f.name); } catch { /* keep 0 */ }
  }

  function closeEditor() {
    if (videoEl) videoEl.pause();
    selectedFile = null;
    streamStart = 0;
    shouldAutoPlay = false;
    videoLoaded = false;
    videoError = '';
    videoDuration = 0;
    currentTime = 0;
    bufferedEnd = 0;
    playing = false;
    markers = [];
    filmstripTime = 0;
    bridgeFrameUrl = null;
    showMetadata = false;
  }

  function onLoadedMetadata() {
    if (!videoDuration && isFinite(videoEl.duration) && videoEl.duration > 0)
      videoDuration = videoEl.duration;
    videoLoaded = true;
    videoError = '';
    bridgeFrameUrl = null;
    filmstripTime = streamStart;
    if (shouldAutoPlay) { shouldAutoPlay = false; videoEl.play().catch(() => {}); }
  }
  function onVideoError() { videoError = 'Failed to load video stream.'; }
  function onTimeUpdate() { currentTime = videoEl.currentTime; }
  function onPlay()  { playing = true; }
  function onPause() { playing = false; filmstripTime = streamStart + (videoEl?.currentTime ?? 0); }
  function onProgress() {
    if (videoEl?.buffered.length)
      bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
  }

  function togglePlay() {
    if (!videoEl) return;
    if (videoEl.paused) videoEl.play(); else videoEl.pause();
  }
  function toggleMute() {
    if (!videoEl) return;
    muted = !muted; videoEl.muted = muted;
  }

  function seekToTime(target: number, autoPlay = false) {
    const clamped = Math.max(0, Math.min(target, videoDuration > 0 ? videoDuration - 2 : target));
    streamStart = clamped;
    filmstripTime = clamped;
    shouldAutoPlay = autoPlay;
    videoLoaded = false;
    bufferedEnd = 0;
    playing = false;
  }

  function skip(secs: number) {
    if (!videoEl) return;
    seekToTime(streamStart + videoEl.currentTime + secs, playing);
  }

  function stepFrame(dir: 1 | -1) {
    if (!videoEl || !videoLoaded) return;
    if (playing) videoEl.pause();
    const step = dir / fps;
    const newRelative = videoEl.currentTime + step;
    if (newRelative >= 0) {
      videoEl.currentTime = newRelative;
      filmstripTime = streamStart + newRelative;
    } else if (streamStart + newRelative >= 0) {
      seekToTime(streamStart + newRelative, false);
    }
  }

  function seekTimeline(e: MouseEvent) {
    if (!timelineEl || !videoDuration) return;
    const rect = timelineEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekToTime(ratio * videoDuration, false);
  }

  function seekFilmstripFrame(ft: number) {
    // The empty_moov stream is treated as live by the browser so currentTime assignment is ignored.
    // Always reload the stream, but show the cached filmstrip thumbnail as a bridge so
    // "Loading…" never flashes — the image is already in the browser's HTTP cache.
    if (selectedFile) bridgeFrameUrl = frameUrl(selectedFile, ft);
    seekToTime(ft, false);
  }

  function addMarker() {
    const t = streamStart + (videoEl?.currentTime ?? 0);
    if (markers.some(m => Math.abs(m - t) < 0.5)) return;
    markers = [...markers, t].sort((a, b) => a - b);
  }

  function removeMarker(i: number) { markers = markers.filter((_, idx) => idx !== i); }

  function markersToAdSegments(ms: number[], dur: number): CutSegment[] {
    if (ms.length === 0 || dur === 0) return [];
    const points = [0, ...ms, dur];
    const ads: CutSegment[] = [];
    for (let i = 0; i < points.length - 1; i += 2) {
      if (points[i + 1] - points[i] > 0.1) ads.push({ start: points[i], end: points[i + 1] });
    }
    return ads;
  }

  function formatSecs(s: number): string {
    if (!isFinite(s) || s < 0) return '--:--';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
  }

  // HH:MM:SS:FF timecode
  function formatTimecode(s: number): string {
    if (!isFinite(s) || s < 0) return '--:--:--:--';
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const fr  = Math.floor((s % 1) * fps);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}:${String(fr).padStart(2,'0')}`;
  }

  $: derivedAdSegments = markersToAdSegments(markers, videoDuration);

  $: keepRegions = (() => {
    if (!videoDuration) return [];
    const cuts = derivedAdSegments;
    const kept: { start: number; end: number }[] = [];
    let pos = 0;
    for (const seg of cuts) {
      if (seg.start > pos + 0.1) kept.push({ start: pos, end: seg.start });
      pos = Math.max(pos, seg.end);
    }
    if (pos < videoDuration - 0.1) kept.push({ start: pos, end: videoDuration });
    return kept;
  })();

  function pct(t: number): string {
    return videoDuration > 0 ? (t / videoDuration * 100).toFixed(3) + '%' : '0%';
  }
  function wPct(s: number, e: number): string {
    return videoDuration > 0 ? ((e - s) / videoDuration * 100).toFixed(3) + '%' : '0%';
  }

  $: displayTime = streamStart + currentTime;
  $: bufEndAbs   = streamStart + bufferedEnd;
  $: playedPct   = videoDuration > 0 ? Math.min(100, displayTime / videoDuration * 100) : 0;
  $: bufStartPct = videoDuration > 0 ? Math.min(100, streamStart  / videoDuration * 100) : 0;
  $: bufEndPct   = videoDuration > 0 ? Math.min(100, bufEndAbs    / videoDuration * 100) : 0;
  $: durationStr = videoDuration > 0 ? formatSecs(videoDuration) : '--:--';

  $: totalCutDuration = derivedAdSegments.reduce((acc, s) => acc + (s.end - s.start), 0);

  function handleImdbSelect(r: ImdbResult) {
    selectedImdb = r;
    if (r.year) year = r.year;
    const t = (r.type ?? '').toLowerCase();
    if (t.includes('series'))       { mediaType = 'series'; seriesTitle = r.title; title = r.title; }
    else if (t.includes('episode')) { mediaType = 'series'; episodeTitle = r.title; }
    else                            { mediaType = 'movie'; title = r.title; }
  }

  function pad(n: number | ''): string { return String(n).padStart(2, '0'); }
  function sanitize(s: string): string { return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim(); }

  $: previewPath = (() => {
    if (!selectedImdb || !title.trim() || year === '') return null;
    if (mediaType === 'movie') {
      const name = sanitize(`${title.trim()} (${year}) [imdbid-${selectedImdb.imdbId}]`);
      return `${name} / ${name}.mp4`;
    }
    const series = sanitize(seriesTitle.trim() || title.trim());
    const epTag  = `S${pad(season || 1)}E${pad(episode || 1)}`;
    const epSfx  = episodeTitle.trim() ? ` - ${sanitize(episodeTitle.trim())}` : '';
    return `${sanitize(`${series} (${year})`)} / Season ${pad(season || 1)} / ${series} - ${epTag}${epSfx}.mp4`;
  })();

  $: canSubmit =
    !submitting && selectedFile !== null && selectedImdb !== null &&
    title.trim() !== '' && year !== '' &&
    (mediaType === 'movie' || (season !== '' && episode !== ''));

  async function handleSubmit(force = false) {
    if (!canSubmit || !selectedImdb || !selectedFile) return;
    if (videoDuration > 0 && totalCutDuration >= videoDuration - 0.5) {
      submitError = 'All content is marked — nothing to keep.'; return;
    }
    submitting = true; submitError = ''; conflictPath = null;
    try {
      const { jobId } = await startCutImport({
        filename: selectedFile, segments: derivedAdSegments,
        title: title.trim(), year: Number(year), imdbId: selectedImdb.imdbId, mediaType,
        seriesTitle: seriesTitle.trim() || undefined,
        season:      season      !== '' ? Number(season)      : undefined,
        episode:     episode     !== '' ? Number(episode)     : undefined,
        episodeTitle: episodeTitle.trim() || undefined,
        force,
      });
      dispatch('job', { jobId });
      markers = [];
    } catch (e: any) {
      if (e instanceof ConflictError) conflictPath = e.existingPath;
      else submitError = e.message ?? 'Failed';
    } finally { submitting = false; }
  }
</script>

<!-- File selector page -->
<div class="cut-editor">
  <section class="file-section">
    <div class="file-header">
      <h2>Select Recording</h2>
      <div class="sort-bar">
        <span class="sort-label">Sort:</span>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <button class="sort-btn" class:active={sortBy === 'mtime'} on:click={() => sortBy = 'mtime'}>Newest</button>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <button class="sort-btn" class:active={sortBy === 'name'} on:click={() => sortBy = 'name'}>Name</button>
      </div>
    </div>

    {#if filesError}
      <p class="msg error">{filesError}</p>
    {:else if files.length === 0}
      <p class="msg">No video files found in the configured uncut recordings folder.</p>
    {:else}
      <div class="file-grid">
        {#each sortedFiles as f}
          {@const imdbId = extractImdbId(f.name)}
          {@const imdb = imdbId ? imdbData.get(imdbId) : null}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="file-card" class:active={f.name === selectedFile} on:click={() => selectFile(f)}>
            <div class="card-poster">
              {#if imdb?.poster}
                <img src={imdb.poster} alt={imdb.title} loading="lazy" />
              {:else}
                <div class="card-poster-placeholder">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="36" height="36"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
                </div>
              {/if}
            </div>
            <div class="card-info">
              {#if imdb}
                <span class="card-title">{imdb.title}{imdb.year ? ` (${imdb.year})` : ''}</span>
              {/if}
              <span class="card-filename">{f.name}</span>
              <span class="card-meta">{formatDate(f.mtime)} · {formatBytes(f.size)}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<!-- Fullscreen editor -->
{#if selectedFile}
  <div class="editor-fs" role="dialog" aria-modal="true" aria-label="Cut Editor">

    <!-- Video fills the entire space -->
    <!-- svelte-ignore a11y-media-has-caption -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <video
      bind:this={videoEl}
      src={uncutStreamUrl(selectedFile ?? '', streamStart)}
      class="fs-video"
      on:loadedmetadata={onLoadedMetadata}
      on:timeupdate={onTimeUpdate}
      on:play={onPlay}
      on:pause={onPause}
      on:progress={onProgress}
      on:click={togglePlay}
      on:error={onVideoError}
    ></video>

    <!-- Centre state overlays (loading / error / play hint) -->
    {#if bridgeFrameUrl && !videoLoaded}
      <img class="bridge-frame" src={bridgeFrameUrl} alt="" />
    {/if}
    {#if videoError}
      <div class="ov-center ov-error">{videoError}</div>
    {:else if !videoLoaded && !bridgeFrameUrl}
      <div class="ov-center ov-loading">Loading…</div>
    {:else if !playing && videoLoaded}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="ov-center ov-play" on:click={togglePlay}>
        <svg viewBox="0 0 24 24" fill="currentColor" width="64" height="64"><path d="M8 5v14l11-7z"/></svg>
      </div>
    {/if}

    <!-- ── Top bar ─────────────────────────────────────────────────────── -->
    <div class="ov-top">
      <span class="ov-filename">{selectedFile}</span>
      <button class="ov-close" on:click={closeEditor} title="Close (Esc)">✕</button>
    </div>

    <!-- ── Bottom bar ─────────────────────────────────────────────────── -->
    <div class="ov-bottom">

      <!-- Timeline (shown as soon as we have a duration) -->
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <div
        class="timeline"
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={videoDuration}
        aria-valuenow={displayTime}
        bind:this={timelineEl}
        on:click={seekTimeline}
      >
        <div class="tl-buf" style="left:{bufStartPct}%;width:{bufEndPct - bufStartPct}%"></div>
        {#each keepRegions as r}
          <div class="tl-region keep" style="left:{pct(r.start)};width:{wPct(r.start,r.end)}"></div>
        {/each}
        {#each derivedAdSegments as s}
          <div class="tl-region cut" style="left:{pct(s.start)};width:{wPct(s.start,s.end)}"></div>
        {/each}
        {#each markers as m, i}
          <div class="tl-marker-hit" style="left:{pct(m)}" title="{formatSecs(m)}">
            <div class="tl-marker-line" class:even={i % 2 === 0}></div>
          </div>
        {/each}
        <div class="tl-marker blue" style="left:{playedPct}%">
          <div class="tl-thumb"></div>
        </div>

        <!-- Filmstrip preview above playhead -->
        {#if videoDuration > 0 && selectedFile}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="filmstrip" style="left:{pct(filmstripTime)}" on:click|stopPropagation>
            {#each filmstripOffsets as offset}
              {@const ft = Math.max(0, Math.min(videoDuration, filmstripTime + offset / fps))}
              {@const inCut = derivedAdSegments.some(s => ft >= s.start && ft <= s.end)}
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                class="fstrip-cell"
                class:current={offset === 0}
                class:in-cut={inCut}
                on:click={() => seekFilmstripFrame(ft)}
                title="{formatTimecode(ft)}"
              >
                <img src={frameUrl(selectedFile, ft)} alt="" />
                <span class="fstrip-off">{offset > 0 ? '+' : ''}{offset}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Transport + time row -->
      <div class="ctrl-row">
        <div class="ctrl-transport">
          <button class="cb" on:click={() => skip(-5)} title="−5 s (←)">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="14.5" text-anchor="middle" font-size="5" fill="currentColor">5</text></svg>
          </button>
          <button class="cb" on:click={() => stepFrame(-1)} title="Previous frame (,)" disabled={!videoLoaded}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button class="cb cb--play" on:click={togglePlay} title="Play/Pause (Space)">
            {#if playing}
              <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg>
            {/if}
          </button>
          <button class="cb" on:click={() => stepFrame(1)} title="Next frame (.)" disabled={!videoLoaded}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
          <button class="cb" on:click={() => skip(10)} title="+10 s (→)">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 5V2l4 4-4 4V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><text x="12" y="14.5" text-anchor="middle" font-size="5" fill="currentColor">10</text></svg>
          </button>
        </div>

        <div class="ctrl-times">
          <span class="time-disp">{formatSecs(displayTime)} / {durationStr}</span>
          <span class="tc-disp" title="Timecode HH:MM:SS:frame ({fps} fps)">{formatTimecode(displayTime)}</span>
        </div>

        <div class="ctrl-right">
          <div class="strip-n-ctrl" title="Filmstrip frames on each side">
            <button class="cb cb-xs" on:click={() => filmstripN = Math.max(1, filmstripN - 1)}>−</button>
            <span class="strip-n-val">{filmstripN}f</span>
            <button class="cb cb-xs" on:click={() => filmstripN = Math.min(10, filmstripN + 1)}>+</button>
          </div>
          <button class="cb" on:click={toggleMute} title="Mute/Unmute">
            {#if muted}
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
            {/if}
          </button>
          <button
            class="cb metadata-btn"
            class:active={showMetadata}
            on:click={() => showMetadata = !showMetadata}
            title="Metadata & Submit"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
            Metadata
          </button>
        </div>
      </div>

      <!-- Marker row -->
      <div class="mark-row">
        <button class="mark-btn" on:click={addMarker} title="Add Marker (M)" disabled={!videoLoaded}>
          + Marker
        </button>
        {#if markers.length > 0}
          <span class="cut-summary">
            {markers.length} marker{markers.length !== 1 ? 's' : ''} · {formatSecs(totalCutDuration)} cut
          </span>
        {/if}
      </div>
    </div>

    <!-- ── Metadata side panel ─────────────────────────────────────────── -->
    {#if showMetadata}
      <div class="meta-panel">
        <div class="meta-hdr">
          <span class="meta-title">Metadata & Submit</span>
          <button class="cb meta-x" on:click={() => showMetadata = false}>✕</button>
        </div>

        {#if markers.length > 0}
          <div class="meta-sec">
            <p class="meta-sec-label">Markers — click timeline line to remove</p>
            <table class="seg-table">
              <thead><tr><th>#</th><th>Time</th><th>After</th><th></th></tr></thead>
              <tbody>
                {#each markers as m, i}
                  <tr>
                    <td>{i + 1}</td>
                    <td>{formatSecs(m)}</td>
                    <td>
                      {#if i % 2 === 0}
                        <span class="badge keep">keep</span>
                      {:else}
                        <span class="badge cut">cut</span>
                      {/if}
                    </td>
                    <td><button class="del-btn" on:click={() => removeMarker(i)}>✕</button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <div class="meta-sec">
          <ImdbSelector query={imdbQuery} selected={selectedImdb} onSelect={handleImdbSelect} />
        </div>

        <div class="meta-sec">
          <MediaForm
            bind:mediaType bind:title bind:year
            bind:seriesTitle bind:season bind:episode bind:episodeTitle
          />
        </div>

        {#if previewPath}
          <div class="preview-path">
            <span class="preview-label">Output path</span>
            <span class="preview-value">{previewPath}</span>
          </div>
        {/if}

        {#if conflictPath}
          <div class="conflict-box">
            <p class="conflict-msg">Already exists in library:</p>
            <p class="conflict-path">{conflictPath}</p>
            <div class="conflict-actions">
              <button class="btn-primary conflict-overwrite" on:click={() => handleSubmit(true)}>Overwrite</button>
              <button class="btn-secondary" on:click={() => conflictPath = null}>Cancel</button>
            </div>
          </div>
        {:else}
          {#if submitError}
            <p class="msg error">{submitError}</p>
          {/if}
          <button class="btn-primary btn-submit" disabled={!canSubmit} on:click={() => handleSubmit()}>
            {submitting ? 'Starting…' : markers.length > 0 ? 'Cut & Transcode' : 'Transcode'}
          </button>
        {/if}
      </div>
    {/if}

  </div>
{/if}

<style>
  /* ── File selector page ─────────────────────────────────────────────── */
  .cut-editor { display: flex; flex-direction: column; gap: 1rem; }
  .file-section { display: flex; flex-direction: column; gap: 0.75rem; }
  .file-header { display: flex; justify-content: space-between; align-items: center; }
  h2 { font-size: 1rem; font-weight: 700; margin: 0; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

  .sort-bar { display: flex; align-items: center; gap: 0.35rem; }
  .sort-label { font-size: 0.75rem; color: var(--text-muted); }
  .sort-btn {
    padding: 0.2rem 0.6rem; font-size: 0.75rem; font-weight: 600;
    border: 1px solid var(--border); border-radius: 5px;
    background: var(--bg-input); color: var(--text-muted);
    cursor: pointer; transition: border-color 0.15s, color 0.15s;
  }
  .sort-btn:hover { border-color: var(--accent); color: var(--accent); }
  .sort-btn.active { border-color: var(--accent); background: var(--accent); color: #fff; }

  .file-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.75rem;
  }

  .file-card {
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg-input);
    cursor: pointer; overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
    display: flex; flex-direction: column;
  }
  .file-card:hover { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent); }
  .file-card.active { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }

  .card-poster {
    aspect-ratio: 2 / 3;
    background: #1f2937;
    overflow: hidden;
    flex-shrink: 0;
  }
  .card-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card-poster-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: #4b5563;
  }

  .card-info {
    padding: 0.45rem 0.5rem;
    display: flex; flex-direction: column; gap: 0.2rem;
    min-width: 0;
  }
  .card-title {
    font-size: 0.78rem; font-weight: 700; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .card-filename {
    font-size: 0.65rem; font-family: ui-monospace, 'Cascadia Code', monospace;
    color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .card-meta { font-size: 0.65rem; color: var(--text-muted); }

  .msg { font-size: 0.875rem; color: var(--text-muted); margin: 0; }
  .msg.error { color: var(--error); }

  /* ── Fullscreen editor ──────────────────────────────────────────────── */
  .editor-fs {
    position: fixed; inset: 0; z-index: 50;
    background: #000;
  }

  .fs-video {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    object-fit: contain;
    display: block;
    cursor: pointer;
  }

  /* Bridge frame — shown while stream reloads after a filmstrip seek */
  .bridge-frame {
    position: absolute; inset: 0; z-index: 1;
    width: 100%; height: 100%; object-fit: contain;
    pointer-events: none;
    background: #000;
  }

  /* Centre overlays */
  .ov-center {
    position: absolute; inset: 0; z-index: 2;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
  }
  .ov-loading { color: #9ca3af; font-size: 0.95rem; }
  .ov-error   { color: #f87171; font-size: 0.95rem; background: rgba(0,0,0,0.6); pointer-events: all; }
  .ov-play    { color: rgba(255,255,255,0.75); pointer-events: all; cursor: pointer; }

  /* Top bar */
  .ov-top {
    position: absolute; top: 0; left: 0; right: 0; z-index: 10;
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.65rem 0.9rem;
    background: linear-gradient(to bottom, rgba(0,0,0,0.72), transparent);
    pointer-events: none;
  }
  .ov-filename {
    font-size: 0.82rem; font-weight: 600; color: #e5e7eb;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: calc(100% - 4rem);
  }
  .ov-close {
    pointer-events: all; flex-shrink: 0;
    background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.2);
    border-radius: 5px; color: #fff; font-size: 0.85rem;
    padding: 0.25rem 0.55rem; cursor: pointer;
    transition: background 0.15s;
  }
  .ov-close:hover { background: rgba(220,38,38,0.7); }

  /* Bottom overlay */
  .ov-bottom {
    position: absolute; bottom: 0; left: 0; right: 0; z-index: 10;
    padding: 0 0.85rem 0.8rem;
    background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.65) 55%, transparent 100%);
    display: flex; flex-direction: column; gap: 0.35rem;
  }

  /* Timeline */
  .timeline {
    position: relative;
    height: 8px;
    background: rgba(255,255,255,0.18);
    border-radius: 4px;
    cursor: pointer;
    overflow: visible;
    margin: 0.4rem 0 0.15rem;
    flex-shrink: 0;
  }
  .tl-buf { position: absolute; top: 0; height: 100%; background: rgba(255,255,255,0.32); border-radius: 4px; pointer-events: none; }
  .tl-region { position: absolute; top: 0; height: 100%; pointer-events: none; border-radius: 4px; }
  .tl-region.keep { background: rgba(34,197,94,0.55); }
  .tl-region.cut  { background: rgba(239,68,68,0.65); }
  /* Playhead */
  .tl-marker {
    position: absolute; top: 50%;
    height: 18px; width: 2px;
    transform: translateX(-1px) translateY(-50%);
    pointer-events: none;
  }
  .tl-marker.blue { background: #3b82f6; }
  .tl-thumb {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 14px; height: 14px;
    background: #3b82f6; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 0 5px rgba(0,0,0,0.6);
  }

  /* User markers */
  .tl-marker-hit {
    position: absolute; top: 0; bottom: 0;
    width: 14px; transform: translateX(-7px);
    z-index: 3;
    display: flex; align-items: center; justify-content: center;
  }
  .tl-marker-line {
    width: 2px; height: 100%;
    background: #facc15;
    border-radius: 1px;
    pointer-events: none;
    transition: width 0.1s, background 0.1s;
  }
  .tl-marker-line.even { background: #34d399; }

  /* Control row */
  .ctrl-row { display: flex; align-items: center; gap: 0.4rem; }
  .ctrl-transport { display: flex; align-items: center; gap: 0.15rem; }
  .ctrl-times {
    display: flex; align-items: center; gap: 0.5rem;
    flex: 1; justify-content: center; min-width: 0;
  }
  .ctrl-right { display: flex; align-items: center; gap: 0.2rem; margin-left: auto; flex-shrink: 0; }

  /* Dark-background buttons */
  .cb {
    display: flex; align-items: center; justify-content: center; gap: 0.3rem;
    background: none; border: none;
    color: rgba(255,255,255,0.82);
    border-radius: 4px; padding: 0.28rem 0.3rem;
    cursor: pointer; font-family: inherit; font-size: inherit;
    transition: color 0.12s, background 0.12s;
  }
  .cb:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,0.15); }
  .cb:disabled { opacity: 0.3; cursor: not-allowed; }
  .cb--play { padding: 0.3rem 0.5rem; }

  .metadata-btn {
    font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em;
    border: 1px solid rgba(255,255,255,0.22); border-radius: 4px;
    padding: 0.22rem 0.6rem; color: rgba(255,255,255,0.75);
  }
  .metadata-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(101,163,13,0.18); }

  /* Time + timecode */
  .time-disp {
    font-size: 0.85rem; font-family: ui-monospace, monospace;
    font-variant-numeric: tabular-nums; color: #f3f4f6; white-space: nowrap;
  }
  .tc-disp {
    font-size: 0.75rem; font-family: ui-monospace, monospace;
    font-variant-numeric: tabular-nums; color: #9ca3af; white-space: nowrap;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
    padding: 0.1rem 0.45rem; background: rgba(0,0,0,0.35);
    cursor: default;
  }

  /* Mark row */
  .mark-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .mark-btn {
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.22);
    border-radius: 4px; color: rgba(255,255,255,0.82); font-size: 0.78rem;
    padding: 0.28rem 0.8rem; cursor: pointer; font-family: inherit;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }
  .mark-btn:hover:not(:disabled) { border-color: rgba(255,255,255,0.5); color: #fff; }
  .mark-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .cut-summary { font-size: 0.75rem; color: #fca5a5; font-weight: 600; margin-left: auto; white-space: nowrap; }

  /* ── Metadata side panel ─────────────────────────────────────────────── */
  .meta-panel {
    position: absolute; right: 0; top: 0; bottom: 0; z-index: 20;
    width: 380px; max-width: 45vw;
    background: var(--bg);
    border-left: 1px solid var(--border);
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 0;
  }

  .meta-hdr {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.75rem 0.9rem 0.6rem;
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; background: var(--bg); z-index: 1;
  }
  .meta-title { font-size: 0.85rem; font-weight: 700; color: var(--text); }
  .meta-x { color: var(--text-muted); font-size: 0.85rem; padding: 0.2rem 0.45rem; color: var(--text-muted); }
  .meta-x:hover { color: var(--error) !important; background: var(--bg-input) !important; }

  .meta-sec {
    padding: 0.75rem 0.9rem;
    border-bottom: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .meta-sec-label {
    font-size: 0.7rem; font-weight: 700; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;
  }

  /* Segment table */
  .seg-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  .seg-table th { text-align: left; padding: 0.2rem 0.4rem; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .seg-table td { padding: 0.28rem 0.4rem; color: var(--text); font-variant-numeric: tabular-nums; font-family: ui-monospace, monospace; border-bottom: 1px solid var(--border); }
  .del-btn { background: none; border: none; color: var(--text-muted); font-size: 0.75rem; padding: 0.1rem 0.3rem; border-radius: 3px; cursor: pointer; transition: color 0.15s; }
  .del-btn:hover { color: var(--error); }
  .badge { font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge.keep { background: rgba(34,197,94,0.18); color: #16a34a; }
  .badge.cut  { background: rgba(239,68,68,0.15); color: #dc2626; }

  /* Output path */
  .preview-path {
    margin: 0 0.9rem;
    display: flex; flex-direction: column; gap: 0.2rem;
    background: var(--bg-input); border: 1px solid var(--border);
    border-left: 3px solid var(--accent); border-radius: 5px;
    padding: 0.45rem 0.65rem; font-size: 0.78rem;
  }
  .preview-label { font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.68rem; }
  .preview-value { font-family: ui-monospace, monospace; color: var(--text); word-break: break-all; }

  .btn-submit { width: calc(100% - 1.8rem); margin: 0.75rem 0.9rem; padding: 0.6rem; font-size: 0.95rem; }

  .conflict-box {
    margin: 0.75rem 0.9rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid #f87171;
    border-left: 3px solid #ef4444;
    border-radius: 6px;
    background: rgba(239,68,68,0.06);
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .conflict-msg { margin: 0; font-size: 0.78rem; font-weight: 700; color: #dc2626; }
  .conflict-path { margin: 0; font-size: 0.7rem; font-family: ui-monospace, monospace; color: var(--text); word-break: break-all; }
  .conflict-actions { display: flex; gap: 0.5rem; margin-top: 0.2rem; }
  .conflict-overwrite { background: #dc2626; font-size: 0.82rem; padding: 0.35rem 0.8rem; }
  .conflict-overwrite:hover { background: #b91c1c; }

  /* ── Filmstrip ─────────────────────────────────────────────────────────── */
  .filmstrip {
    position: absolute;
    bottom: calc(100% + 10px);
    transform: translateX(-50%);
    display: flex;
    gap: 2px;
    pointer-events: all;
    z-index: 12;
    filter: drop-shadow(0 2px 14px rgba(0,0,0,0.95));
  }
  .fstrip-cell {
    position: relative;
    width: 80px;
    height: 45px;
    background: #111827;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 2px;
    overflow: hidden;
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.1s, transform 0.1s;
  }
  .fstrip-cell:hover { border-color: rgba(255,255,255,0.65); transform: scale(1.06); z-index: 1; }
  .fstrip-cell.current { border: 2px solid #3b82f6; }
  .fstrip-cell.in-cut::after {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(239, 68, 68, 0.30);
    pointer-events: none;
  }
  .fstrip-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .fstrip-off {
    position: absolute;
    bottom: 1px;
    right: 2px;
    font-size: 9px;
    color: rgba(255,255,255,0.55);
    font-family: ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    pointer-events: none;
  }

  /* Filmstrip N control */
  .strip-n-ctrl {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 4px;
    padding: 0 0.1rem;
  }
  .cb-xs { padding: 0.15rem 0.25rem; font-size: 0.7rem; }
  .strip-n-val { font-size: 0.7rem; font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.65); min-width: 1.6rem; text-align: center; }
</style>

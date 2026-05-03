/**
 * Translates a HandBrake preset JSON into ffmpeg argument arrays.
 *
 * Supported: video codec/CRF/bitrate/preset/tune/profile/level, frame-rate modes,
 * audio codec/bitrate/mixdown/samplerate, picture crops (manual only),
 * scale, deinterlace (yadif), denoise (hqdn3d), sharpen (unsharp),
 * multi-pass bitrate encoding, MP4/MKV container.
 *
 * Not translated: subtitle handling, chapter markers, HDR metadata passthrough,
 * auto-crop (requires per-source analysis), chroma-smooth, deblock, detelecine.
 */

// ── Type definitions ──────────────────────────────────────────────────────────

export interface HBPreset {
  PresetName?: string;
  Default?: boolean;
  // Video
  VideoEncoder: string;
  VideoQualityType: number;   // 0=avg bitrate, 1=const bitrate, 2=CRF
  VideoQualitySlider: number;
  VideoAvgBitrate: number;
  VideoPreset?: string;
  VideoTune?: string;
  VideoProfile?: string;
  VideoLevel?: string;
  VideoOptionExtra?: string;
  VideoFramerate?: string;
  VideoFramerateMode?: string; // cfr | vfr | pfr
  VideoGrayScale?: boolean;
  VideoMultiPass?: boolean;
  VideoTurboMultiPass?: boolean;
  // Audio
  AudioList?: HBAudioTrack[];
  AudioEncoderFallback?: string;
  // Picture / filters
  FileFormat?: string;
  AlignAVStart?: boolean;
  Optimize?: boolean;
  PictureAutoCrop?: boolean;
  PictureCropMode?: number;    // 0=auto, 1=auto-relaxed, 2=custom
  PictureTopCrop?: number;
  PictureBottomCrop?: number;
  PictureLeftCrop?: number;
  PictureRightCrop?: number;
  PictureWidth?: number;
  PictureHeight?: number;
  PictureKeepRatio?: boolean;
  PictureDeinterlaceFilter?: string;  // off | yadif | decomb
  PictureDeinterlacePreset?: string;
  PictureDenoiseFilter?: string;      // off | hqdn3d | nlmeans
  PictureDenoisePreset?: string;
  PictureSharpenFilter?: string;      // off | unsharp | lapsharp
  PictureSharpenPreset?: string;
  PictureSharpenTune?: string;
}

export interface HBAudioTrack {
  AudioEncoder: string;
  AudioBitrate?: number;
  AudioMixdown?: string;
  AudioSamplerate?: string;
  AudioTrackQualityEnable?: boolean;
  AudioTrackQuality?: number;
  AudioCompressionLevel?: number;
}

export interface HBPresetFile {
  PresetList: HBPreset[];
  VersionMajor?: number;
}

export interface TranscodeJob {
  passes: string[][];
  outputExt: string;
}

// ── Lookup tables ─────────────────────────────────────────────────────────────

const VIDEO_CODEC: Record<string, string> = {
  x264: 'libx264', x265: 'libx265',
  mpeg4: 'mpeg4', mpeg2: 'mpeg2video',
  VP8: 'libvpx', VP9: 'libvpx-vp9',
  theora: 'libtheora',
  av1: 'libaom-av1', svt_av1: 'libsvtav1',
  nvenc_h264: 'h264_nvenc', nvenc_h265: 'hevc_nvenc',
  vce_h264: 'h264_amf', vce_h265: 'hevc_amf',
  qsv_h264: 'h264_qsv', qsv_h265: 'hevc_qsv',
  vt_h264: 'h264_videotoolbox', vt_h265: 'hevc_videotoolbox',
  mf_h264: 'h264_mf', mf_h265: 'hevc_mf',
};

const AUDIO_CODEC: Record<string, string> = {
  av_aac: 'aac', fdk_aac: 'libfdk_aac', fdk_haac: 'libfdk_aac',
  ac3: 'ac3', eac3: 'eac3', truehd: 'truehd',
  mp3: 'libmp3lame', vorbis: 'libvorbis', opus: 'libopus',
  flac16: 'flac', flac24: 'flac',
  passthru: 'copy', copy: 'copy',
};

const MIXDOWN_AC: Record<string, number> = {
  mono: 1, stereo: 2, dpl1: 2, dpl2: 2,
  '5point1': 6, '6point1': 7, '7point1': 8, '7point1_wide': 8,
};

const CONTAINER_EXT: Record<string, string> = {
  av_mp4: 'mp4', av_mkv: 'mkv', av_webm: 'webm',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapCodec(map: Record<string, string>, key: string, label: string): string {
  const v = map[key];
  if (!v) throw new Error(`Unsupported ${label} encoder: "${key}"`);
  return v;
}

function buildVideoFilter(p: HBPreset): string[] {
  const filters: string[] = [];

  // Crop — only apply when PictureCropMode is 2 (custom/manual)
  if (
    p.PictureCropMode === 2 &&
    (p.PictureTopCrop || p.PictureBottomCrop || p.PictureLeftCrop || p.PictureRightCrop)
  ) {
    const t = p.PictureTopCrop ?? 0, b = p.PictureBottomCrop ?? 0;
    const l = p.PictureLeftCrop ?? 0, r = p.PictureRightCrop ?? 0;
    filters.push(`crop=in_w-${l + r}:in_h-${t + b}:${l}:${t}`);
  }

  // Scale (only when explicit dimensions given)
  const w = p.PictureWidth ?? 0, h = p.PictureHeight ?? 0;
  if (w > 0 || h > 0) {
    const wPart = w > 0 ? String(w) : '-2';
    const hPart = h > 0 ? String(h) : '-2';
    filters.push(`scale=${wPart}:${hPart}`);
  }

  // Deinterlace
  const deintFilter = (p.PictureDeinterlaceFilter ?? 'off').toLowerCase();
  if (deintFilter !== 'off') {
    // yadif mode=2 = deinterlace only flagged-interlaced frames (closest to decomb)
    const preset = (p.PictureDeinterlacePreset ?? '').toLowerCase();
    const mode = preset === 'bob' ? 1 : 2;
    filters.push(`yadif=${mode}`);
  }

  // Denoise
  const denoiseFilter = (p.PictureDenoiseFilter ?? 'off').toLowerCase();
  if (denoiseFilter !== 'off' && denoiseFilter !== '') {
    const preset = (p.PictureDenoisePreset ?? 'medium').toLowerCase();
    const hqdn3dPresets: Record<string, string> = {
      ultralight: '1:0.7:4:3.5',
      light: '2:1.3:8:7',
      medium: '3:2:6:4.5',
      strong: '7:7:7:5',
    };
    const params = hqdn3dPresets[preset] ?? hqdn3dPresets.medium;
    filters.push(`hqdn3d=${params}`);
  }

  // Sharpen
  const sharpenFilter = (p.PictureSharpenFilter ?? 'off').toLowerCase();
  if (sharpenFilter === 'unsharp' || sharpenFilter === 'lapsharp') {
    const preset = (p.PictureSharpenPreset ?? 'medium').toLowerCase();
    const unsharpPresets: Record<string, string> = {
      ultralight: '3:3:0.5:3:3:0',
      light: '5:5:0.5:5:5:0',
      medium: '5:5:0.8:5:5:0',
      strong: '5:5:1.5:5:5:0',
      stronger: '5:5:2:5:5:0',
    };
    filters.push(`unsharp=${unsharpPresets[preset] ?? unsharpPresets.medium}`);
  }

  // Grayscale
  if (p.VideoGrayScale) filters.push('format=gray');

  return filters.length ? ['-vf', filters.join(',')] : [];
}

function buildAudioArgs(tracks: HBAudioTrack[]): string[] {
  if (!tracks.length) return ['-an'];
  const args: string[] = [];

  // Map each audio track — we apply them in order with stream specifiers
  tracks.forEach((t, i) => {
    const spec = tracks.length > 1 ? `:${i}` : '';

    const encoderKey = t.AudioEncoder.toLowerCase();
    let codec = AUDIO_CODEC[encoderKey];
    if (!codec) {
      // Try stripping 'copy:' prefix (e.g. 'copy:aac')
      codec = encoderKey.startsWith('copy:') ? 'copy' : 'aac';
    }
    args.push(`-c:a${spec}`, codec);

    if (codec !== 'copy') {
      if (t.AudioBitrate && t.AudioBitrate > 0) {
        args.push(`-b:a${spec}`, `${t.AudioBitrate}k`);
      }
      const ac = MIXDOWN_AC[(t.AudioMixdown ?? '').toLowerCase()];
      if (ac) args.push(`-ac${spec}`, String(ac));
      if (t.AudioSamplerate && t.AudioSamplerate !== 'auto') {
        args.push(`-ar${spec}`, t.AudioSamplerate);
      }
    }
  });

  return args;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function presetToFfmpeg(
  preset: HBPreset,
  inputPath: string,
  outputPath: string,
  passLogBase: string,
): TranscodeJob {
  const videoCodec = mapCodec(VIDEO_CODEC, preset.VideoEncoder, 'video');
  const outputExt = CONTAINER_EXT[preset.FileFormat ?? 'av_mp4'] ?? 'mp4';
  const audioTracks = preset.AudioList ?? [];

  // ── Video quality args ────────────────────────────────────────────────────
  const qualityArgs: string[] = [];
  const qtype = preset.VideoQualityType ?? 2;
  if (qtype === 2) {
    qualityArgs.push('-crf', String(Math.round(preset.VideoQualitySlider ?? 22)));
  } else {
    qualityArgs.push('-b:v', `${preset.VideoAvgBitrate ?? 6000}k`);
  }

  // ── Video codec options ───────────────────────────────────────────────────
  const codecArgs: string[] = ['-c:v', videoCodec, ...qualityArgs];
  if (preset.VideoPreset) codecArgs.push('-preset', preset.VideoPreset);
  if (preset.VideoTune) codecArgs.push('-tune', preset.VideoTune);
  if (preset.VideoProfile) codecArgs.push('-profile:v', preset.VideoProfile);
  if (preset.VideoLevel) codecArgs.push('-level:v', preset.VideoLevel);
  if (preset.VideoOptionExtra) {
    // Extra options are semicolon-separated key=value pairs in HB
    for (const opt of preset.VideoOptionExtra.split(':')) {
      const [k, v] = opt.split('=');
      if (k) codecArgs.push(`-${k}`, v ?? '');
    }
  }

  // ── Frame rate ────────────────────────────────────────────────────────────
  const frateArgs: string[] = [];
  const fr = preset.VideoFramerate;
  const frMode = (preset.VideoFramerateMode ?? 'cfr').toLowerCase();
  if (fr && fr !== 'same as source') {
    if (frMode === 'cfr') {
      frateArgs.push('-r', fr);
    } else if (frMode === 'pfr') {
      // Peak frame rate: cap but don't duplicate. -fpsmax drops frames above the
      // limit without forcing CFR (combining -r with a non-CFR fps_mode is an error in ffmpeg 7+).
      frateArgs.push('-fpsmax', fr);
    }
    // vfr: no -r, source timing preserved
  }

  // ── Filters ───────────────────────────────────────────────────────────────
  const filterArgs = buildVideoFilter(preset);

  // ── Container / mux options ───────────────────────────────────────────────
  const muxArgs: string[] = [];
  if (outputExt === 'mp4') {
    if (preset.AlignAVStart || preset.Optimize) muxArgs.push('-movflags', '+faststart');
  }

  // ── Multi-pass (only meaningful for bitrate mode) ─────────────────────────
  const useMultiPass = (preset.VideoMultiPass ?? false) && qtype !== 2;

  if (useMultiPass) {
    const passflag = ['-passlogfile', passLogBase];
    const turbo = preset.VideoTurboMultiPass ? ['-preset', 'ultrafast'] : [];

    const pass1 = [
      '-y', '-i', inputPath,
      '-c:v', videoCodec, ...qualityArgs,
      ...turbo,
      '-pass', '1', ...passflag,
      '-an', '-f', 'null', '/dev/null',
    ];

    const pass2 = [
      '-y', '-i', inputPath,
      ...codecArgs, ...frateArgs, ...filterArgs,
      '-pass', '2', ...passflag,
      ...buildAudioArgs(audioTracks),
      ...muxArgs,
      outputPath,
    ];

    return { passes: [pass1, pass2], outputExt };
  }

  const singlePass = [
    '-y', '-i', inputPath,
    ...codecArgs, ...frateArgs, ...filterArgs,
    ...buildAudioArgs(audioTracks),
    ...muxArgs,
    outputPath,
  ];

  return { passes: [singlePass], outputExt };
}

export function loadPreset(json: string): HBPreset {
  const data = JSON.parse(json) as HBPresetFile;
  const list = data.PresetList;
  if (!list?.length) throw new Error('No presets found in file');
  // Use the first preset marked Default, or just the first one
  return list.find(p => p.Default) ?? list[0];
}

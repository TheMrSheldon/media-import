import { readFile } from 'fs/promises';
import { config } from '../config.js';
import { loadPreset, type HBPreset } from './preset-parser.js';

export let activePreset: HBPreset | null = null;

export async function initPreset(): Promise<void> {
  try {
    const raw = await readFile(config.presetPath, 'utf-8');
    activePreset = loadPreset(raw);
    console.log(`  Preset  → "${activePreset.PresetName ?? 'unnamed'}" (${config.presetPath})`);
  } catch {
    console.warn(`  Preset  → not found at ${config.presetPath}, using built-in defaults`);
  }
}

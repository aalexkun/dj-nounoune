import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { spawn } from 'child_process';

/** The parts of `ffprobe -show_format -show_streams` this app reads; the rest passes through untyped. */
const FFProbeOutputSchema = z.object({
  streams: z.array(
    z.looseObject({
      codec_type: z.string(),
      codec_name: z.string(),
      sample_rate: z.string().optional(),
      bit_rate: z.string().optional(),
      duration: z.string().optional(),
      bits_per_raw_sample: z.string().optional(), // Often present for PCM/Lossless
      bits_per_sample: z.number().optional(), // Fallback
    }),
  ),
  format: z.looseObject({
    filename: z.string(),
    size: z.string().optional(),
    duration: z.string().optional(),
    bit_rate: z.string().optional(),
  }),
});

export type FFProbeOutput = z.infer<typeof FFProbeOutputSchema>;

@Injectable()
export class ShellService {
  public async getTechnicalInfo(filePath: string): Promise<FFProbeOutput> {
    // Sanitize file path (Validation check)
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('Invalid file path provided to ffprobe');
    }

    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath];

    return new Promise((resolve, reject) => {
      // 1. Spawn the process
      const process = spawn('ffprobe', args);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      // 2. Collect stdout data
      process.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      // 3. Collect stderr data
      process.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      // 4. Handle process errors (e.g., ffprobe not installed)
      process.on('error', (err) => {
        reject(new Error(`Failed to start ffprobe process: ${err.message}`));
      });

      // 5. Handle process completion
      process.on('close', (code) => {
        if (code !== 0) {
          const errorOutput = Buffer.concat(stderrChunks).toString('utf-8');
          reject(new Error(`ffprobe failed with code ${code}: ${errorOutput}`));
          return;
        }

        const output = Buffer.concat(stdoutChunks).toString('utf-8');

        try {
          const parsedOutput: unknown = JSON.parse(output);
          resolve(FFProbeOutputSchema.parse(parsedOutput));
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${e instanceof Error ? e.message : String(e)}`));
        }
      });
    });
  }

  public async executeBpmTag(filePath: string): Promise<number> {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('Invalid file path provided to bpm-tag');
    }

    const args = ['tempo', filePath];

    return new Promise((resolve, reject) => {
      const process = spawn('aubio', args);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      process.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      process.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      process.on('error', (err) => {
        reject(new Error(`Failed to start bpm-tag process: ${err.message}`));
      });

      process.on('close', (code) => {
        const output = Buffer.concat(stdoutChunks).toString('utf-8');
        const errorOutput = Buffer.concat(stderrChunks).toString('utf-8');

        if (code !== 0) {
          reject(new Error(`bpm-tag failed with code ${code}: ${errorOutput || output}`));
          return;
        }

        const match = output.match(/\d+\.\d+(?=\s+bpm)/);
        if (match) {
          resolve(parseFloat(match[0]));
        } else {
          // If stdout doesn't have it, bpm-tag might output to stderr
          const errMatch = errorOutput.match(/\d+\.\d+(?=\s+bpm)/);
          if (errMatch) {
            resolve(parseFloat(errMatch[0]));
          } else {
            resolve(0);
          }
        }
      });
    });
  }
}

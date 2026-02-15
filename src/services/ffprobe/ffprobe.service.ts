import { Injectable } from '@nestjs/common';

import { spawn } from 'child_process';

export interface FFProbeOutput {
  streams: Array<{
    codec_type: string;
    codec_name: string;
    sample_rate?: string;
    bit_rate?: string;
    duration?: string;
    bits_per_raw_sample?: string; // Often present for PCM/Lossless
    bits_per_sample?: number; // Fallback
    [key: string]: any;
  }>;
  format: {
    filename: string;
    size?: string;
    duration?: string;
    bit_rate?: string;
    [key: string]: any;
  };
}

@Injectable()
export class FfprobeService {
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
      process.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk);
      });

      // 3. Collect stderr data
      process.stderr.on('data', (chunk) => {
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
          const parsedOutput = JSON.parse(output);
          resolve(parsedOutput);
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${e instanceof Error ? e.message : String(e)}`));
        }
      });
    });
  }
}

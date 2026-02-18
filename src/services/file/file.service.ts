import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { writeFile, mkdir, readFile } from 'fs/promises';
import * as path from 'path';
import * as fs from 'fs'; // Used only for checking directory existence synchronously if needed

@Injectable()
export class FileService {
  async saveFile(filename: string, content: string): Promise<void> {
    try {
      // 1. Define the path (relative to project root)
      const uploadDir = path.join(process.cwd(), 'files');
      const filePath = path.join(uploadDir, filename);

      // 2. Ensure the directory exists (optional safety step)
      // verify if the directory exists, if not, create it
      // Using fs/promises mkdir with recursive: true is safest
      await mkdir(uploadDir, { recursive: true });

      // 3. Write the file
      // 'utf-8' is the default encoding
      await writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error('Error writing file:', error);
      throw new InternalServerErrorException('Could not write file to disk');
    }
  }

  async getFileContent(filename: string): Promise<string> {
    try {
      const filePath = path.join(process.cwd(), 'files', filename);

      return await readFile(filePath, 'utf-8');
    } catch (error) {
      // Log the error and throw a NestJS HTTP exception
      console.error(error);
      throw new InternalServerErrorException('Could not read file');
    }
  }
}

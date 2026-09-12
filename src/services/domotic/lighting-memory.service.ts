import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LightingMemory, LightingMemoryDocument, LightingMemoryEntry } from '../../schemas/lighting-memory.schema';

/** The only scope today. Kept as a field so a per-user memory can sit beside it later. */
export const HOUSEHOLD_SCOPE = 'household';

/** How many raw requests travel with the summary. Enough to see a correction and what it corrected. */
export const RECENT_ENTRIES = 12;

/** The summary is model-written; this is the ceiling it is cut to whatever the model returns. */
export const SUMMARY_MAX_CHARS = 1500;

export interface HouseholdLightingMemory {
  summary: string;
  recent: LightingMemoryEntry[];
  requests: number;
}

const EMPTY: HouseholdLightingMemory = { summary: '', recent: [], requests: 0 };

/**
 * The household's lighting memory document. Reads never fail — no document is an empty memory —
 * and writes replace the summary while appending to the capped tail.
 */
@Injectable()
export class LightingMemoryService {
  constructor(@InjectModel(LightingMemory.name) private readonly memoryModel: Model<LightingMemoryDocument>) {}

  async get(): Promise<HouseholdLightingMemory> {
    const document = await this.memoryModel.findOne({ scope: HOUSEHOLD_SCOPE }).lean().exec();

    if (!document) return EMPTY;

    return { summary: document.summary ?? '', recent: document.recent ?? [], requests: document.requests ?? 0 };
  }

  /** Records one request and the summary that now accounts for it. */
  async record(summary: string, entry: LightingMemoryEntry): Promise<void> {
    await this.memoryModel
      .updateOne(
        { scope: HOUSEHOLD_SCOPE },
        {
          $set: { summary: summary.slice(0, SUMMARY_MAX_CHARS) },
          $inc: { requests: 1 },
          $push: { recent: { $each: [entry], $slice: -RECENT_ENTRIES } },
        },
        { upsert: true },
      )
      .exec();
  }

  async clear(): Promise<boolean> {
    const result = await this.memoryModel.deleteOne({ scope: HOUSEHOLD_SCOPE }).exec();
    return result.deletedCount > 0;
  }
}

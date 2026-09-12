import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LightingScene, LightingSceneDocument, LightingSceneState } from '../../schemas/lighting-scene.schema';
import { HueLightUpdate, isHueEffect } from './hue.interfaces';
import { ResolvedLightingUpdate } from './lighting.interfaces';

/** `Cosy  Evening ` and `cosy evening` are the same scene. */
export function sceneKey(title: string): string {
  return title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A scene as callers read it: the document without Mongo's own fields. */
export interface SavedScene {
  key: string;
  title: string;
  description?: string;
  room?: string;
  states: LightingSceneState[];
  updatedAt?: Date;
}

/**
 * Named arrangements the household keeps, in Mongo.
 *
 * Stored already resolved to light ids and bridge units, so recalling a scene is a replay with no
 * model in the loop. Saving over an existing title replaces it: "remember this as cosy" said twice
 * means the second one.
 */
@Injectable()
export class LightingSceneService {
  constructor(@InjectModel(LightingScene.name) private readonly sceneModel: Model<LightingSceneDocument>) {}

  async list(): Promise<SavedScene[]> {
    const documents = await this.sceneModel.find().sort({ title: 1 }).lean().exec();
    return documents.map((document) => toSavedScene(document));
  }

  async get(title: string): Promise<SavedScene | null> {
    const document = await this.sceneModel
      .findOne({ key: sceneKey(title) })
      .lean()
      .exec();
    return document ? toSavedScene(document) : null;
  }

  async save(
    input: { title: string; description?: string; room?: string; createdBy: string },
    resolved: ResolvedLightingUpdate[],
  ): Promise<SavedScene> {
    const states = resolved.map((entry) => toState(entry));
    const key = sceneKey(input.title);

    const document = await this.sceneModel
      .findOneAndUpdate(
        { key },
        { $set: { key, title: input.title.trim(), description: input.description, room: input.room, states, createdBy: input.createdBy } },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    return toSavedScene(document);
  }

  async remove(title: string): Promise<boolean> {
    const result = await this.sceneModel.deleteOne({ key: sceneKey(title) }).exec();
    return result.deletedCount > 0;
  }

  /** The stored states as writes, for `DomoticService.applyById`. */
  static toUpdates(scene: SavedScene): Array<{ lightId: string; update: HueLightUpdate }> {
    return scene.states.map((state) => {
      const update: HueLightUpdate = {};

      if (state.on !== undefined) update.on = state.on;
      if (state.brightness !== undefined) update.brightness = state.brightness;
      if (state.colorX !== undefined && state.colorY !== undefined) update.colorXy = { x: state.colorX, y: state.colorY };
      if (state.mirek !== undefined) update.mirek = state.mirek;
      if (state.effect !== undefined && isHueEffect(state.effect)) update.effect = state.effect;

      return { lightId: state.lightId, update };
    });
  }
}

function toState(entry: ResolvedLightingUpdate): LightingSceneState {
  return {
    lightId: entry.light.id,
    label: entry.light.label ?? entry.light.name,
    on: entry.update.on,
    brightness: entry.update.brightness,
    colorX: entry.update.colorXy?.x,
    colorY: entry.update.colorXy?.y,
    mirek: entry.update.mirek,
    effect: entry.update.effect,
  };
}

function toSavedScene(document: LightingScene & { updatedAt?: Date }): SavedScene {
  return {
    key: document.key,
    title: document.title,
    description: document.description,
    room: document.room,
    states: document.states ?? [],
    updatedAt: document.updatedAt,
  };
}

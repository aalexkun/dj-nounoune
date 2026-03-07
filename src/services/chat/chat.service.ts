import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Chat, ChatDocument, ChatMessage } from '../../schemas/chat.schema';
import { Content } from '@google/genai';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Chat.name)
    private readonly chatModel: Model<ChatDocument>,
  ) {}

  async findAll(): Promise<Chat[]> {
    return await this.chatModel.find().exec();
  }

  async findOne(id: string): Promise<Chat> {
    const chat = await this.chatModel.findById(new Types.ObjectId(id)).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
    return chat;
  }

  async update(id: string, updateChatDto: Partial<Chat>): Promise<Chat> {
    const chat = await this.chatModel.findById(new Types.ObjectId(id)).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
    Object.assign(chat, updateChatDto);
    return chat.save();
  }

  async create(topic: string, userId: string): Promise<Chat> {
    const createdChat = new this.chatModel({ userId, topic, history: [] });
    return createdChat.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.chatModel.findByIdAndDelete(new Types.ObjectId(id)).exec();
    if (!result) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
  }

  async getHistory(id: string): Promise<ChatMessage[]> {
    console.log(`Retrieving history for chat with ID: ${id}`);
    const chat = await this.chatModel.findById(new Types.ObjectId(id)).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
    return chat.history;
  }
  async saveHistory(id: string, history: ChatMessage[] | Content[]): Promise<void> {
    const chat = await this.chatModel.findById(new Types.ObjectId(id)).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
    chat.history = history;
    await chat.save();
  }
}

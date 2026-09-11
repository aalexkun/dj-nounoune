import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiAuthGuard } from '../services/auth/api-auth.guard';
import { ChatService } from '../services/chat/chat.service';
import { ChatStreamService } from '../services/chat/chat-stream.service';

@Controller('chatroom')
@UseGuards(ApiAuthGuard)
export class ChatController {
  constructor(
    public readonly chatService: ChatService,
    private readonly chatStream: ChatStreamService,
  ) {}

  @Get('') // Handles /chatroom
  async getChatrooms() {
    return this.chatService.findAll();
  }

  @Post() // Handles POST /chatroom
  async createChatroom(@Body() body: { topic: string; userId: string }) {
    return this.chatService.create(body.topic, body.userId);
  }

  @Get(':id') // Handles GET /chatroom/{id}
  async getChatroom(@Param('id') id: string) {
    return this.chatService.findOne(id);
  }

  @Delete(':id') // Handles DELETE /chatroom/{id}
  async deleteChatroom(@Param('id') id: string) {
    await this.chatService.remove(id);
    return { success: true };
  }

  /**
   * The Gemini transcript — `Content[]`, shaped by what the model API needs.
   *
   * Kept because the CLI still reads it and the agent loop owns it. It is **not** what the app
   * renders: see `/messages` below.
   */
  @Get(':id/history') // Handles GET /chatroom/{id}/history
  async getHistory(@Param('id') id: string) {
    return this.chatService.getHistory(id);
  }

  /**
   * The presentation timeline, in exactly the shape the socket emits.
   *
   * The same query `chat:resync` runs, so the REST path and the socket path cannot drift — which is
   * what lets the app keep one decoder instead of the two divergent mappings it used to maintain,
   * one for live strings and one for Gemini `Content`.
   */
  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @Query('sinceSeq', new ParseIntPipe({ optional: true })) sinceSeq?: number,
    @Query('sinceUpdatedAt', new ParseIntPipe({ optional: true })) sinceUpdatedAt?: number,
  ) {
    return this.chatStream.backlog(id, { sinceSeq, sinceUpdatedAt });
  }
}

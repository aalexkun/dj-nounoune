import { Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiAuthGuard } from '../services/auth/api-auth.guard';
import { ChatService, summaryOf } from '../services/chat/chat.service';
import { ChatStreamService } from '../services/chat/chat-stream.service';

@Controller('chatroom')
@UseGuards(ApiAuthGuard)
export class ChatController {
  constructor(
    public readonly chatService: ChatService,
    private readonly chatStream: ChatStreamService,
  ) {}

  /**
   * The chatroom listing: one summary row per conversation, newest first.
   *
   * It used to answer with the `Chat` documents themselves, `history` and all — every Gemini
   * transcript on the server, in the model API's own shape, on every app start. The client decoded
   * that with a second mapping of `Content` maintained beside the protocol one, and it threw:
   * `functionResponse.response.output` is a string when a tool returned text and an object when it
   * returned anything else, and the client had declared it a string. So the list stopped carrying
   * transcripts, and the preview it does carry comes from the envelope log instead — the same
   * `copyText` the app would have rendered, one aggregate rather than a megabyte of parts.
   *
   * `x-user-id` scopes it when the caller sends one, which every client does; without it this is
   * still the whole server, which is what the CLI and a curl from a laptop want.
   */
  @Get('') // Handles /chatroom
  async getChatrooms(@Headers('x-user-id') userId?: string) {
    return this.chatService.summaries(userId);
  }

  /**
   * Answers in the same shape as the listing, so a client has one row type rather than two.
   *
   * `lastMessage` is empty because a chat one millisecond old has no messages — not because the
   * field is unavailable here.
   */
  @Post() // Handles POST /chatroom
  async createChatroom(@Body() body: { topic: string; userId: string }) {
    return summaryOf(await this.chatService.create(body.topic, body.userId));
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

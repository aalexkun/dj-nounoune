import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../services/auth/current-user.decorator';
import { SessionAuthGuard } from '../services/auth/session-auth.guard';
import type { AuthenticatedUser } from '../services/auth/auth.types';
import { ChatService, summaryOf } from '../services/chat/chat.service';
import { ChatStreamService } from '../services/chat/chat-stream.service';

/**
 * What a client may say when it opens a conversation, and nothing more.
 *
 * `userId` used to be in this body and was believed. It is silently ignored rather than rejected:
 * an app build that still sends it keeps working through the transition, and the id it sends has
 * stopped meaning anything either way — the owner is the session's.
 */
const CreateChatroomSchema = z.object({
  topic: z.string().optional(),
});

@Controller('chatroom')
@UseGuards(SessionAuthGuard)
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
   * It is always the caller's own conversations. It used to be scoped by whatever `x-user-id` the
   * caller chose to send, and to be the whole server when it sent none.
   */
  @Get('') // Handles /chatroom
  async getChatrooms(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.summaries(user.id);
  }

  /**
   * Answers in the same shape as the listing, so a client has one row type rather than two.
   *
   * `lastMessage` is empty because a chat one millisecond old has no messages — not because the
   * field is unavailable here.
   */
  @Post() // Handles POST /chatroom
  async createChatroom(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { topic } = CreateChatroomSchema.parse(body);
    return summaryOf(await this.chatService.create(topic ?? '', user.id));
  }

  @Get(':id') // Handles GET /chatroom/{id}
  async getChatroom(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.chatService.findOne(id, user.id);
  }

  @Delete(':id') // Handles DELETE /chatroom/{id}
  async deleteChatroom(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.chatService.remove(id, user.id);
    return { success: true };
  }

  /**
   * The Gemini transcript — `Content[]`, shaped by what the model API needs.
   *
   * Kept because the CLI still reads it and the agent loop owns it. It is **not** what the app
   * renders: see `/messages` below.
   */
  @Get(':id/history') // Handles GET /chatroom/{id}/history
  async getHistory(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.chatService.getHistory(id, user.id);
  }

  /**
   * The presentation timeline, in exactly the shape the socket emits.
   *
   * The same query `chat:resync` runs, so the REST path and the socket path cannot drift — which is
   * what lets the app keep one decoder instead of the two divergent mappings it used to maintain,
   * one for live strings and one for Gemini `Content`.
   *
   * The envelope log is keyed on `chatId` and knows nothing about owners, so this is the one route
   * where ownership cannot be a clause of the query it runs. `assertOwned` is that clause, standing
   * in front of it.
   */
  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('sinceSeq', new ParseIntPipe({ optional: true })) sinceSeq?: number,
    @Query('sinceUpdatedAt', new ParseIntPipe({ optional: true })) sinceUpdatedAt?: number,
  ) {
    await this.chatService.assertOwned(id, user.id);
    return this.chatStream.backlog(id, { sinceSeq, sinceUpdatedAt });
  }
}

import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiAuthGuard } from '../services/auth/api-auth.guard';
import { ChatService } from '../services/chat/chat.service';

@Controller('chatroom')
@UseGuards(ApiAuthGuard)
export class ChatController {
  constructor(public readonly chatService: ChatService) {}

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

  @Get(':id/history') // Handles GET /chatroom/{id}/history
  async getHistory(@Param('id') id: string) {
    return this.chatService.getHistory(id);
  }
}

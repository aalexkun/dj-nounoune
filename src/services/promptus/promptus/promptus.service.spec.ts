import { Test, TestingModule } from '@nestjs/testing';
import { PromptusService } from './promptus.service';

describe('PromptusService', () => {
  let service: PromptusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptusService],
    }).compile();

    service = module.get<PromptusService>(PromptusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

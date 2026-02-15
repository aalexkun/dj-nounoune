import { Test, TestingModule } from '@nestjs/testing';
import { FfprobeService } from './ffprobe.service';

describe('FfprobeService', () => {
  let service: FfprobeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FfprobeService],
    }).compile();

    service = module.get<FfprobeService>(FfprobeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

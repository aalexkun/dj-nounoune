import { Test, TestingModule } from '@nestjs/testing';
import { MusicDbService } from './music-db.service';

describe('MusicDbService', () => {
  let service: MusicDbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MusicDbService],
    }).compile();

    service = module.get<MusicDbService>(MusicDbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

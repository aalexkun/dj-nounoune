
import { Test, TestingModule } from '@nestjs/testing';
import { MpdClientService } from './mpd-client.service';
import { AppService } from '../../app.service';

describe('MpdClientService', () => {
  let service: MpdClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpdClientService,
        {
          provide: AppService,
          useValue: {
            getMpdHost: jest.fn().mockReturnValue('localhost'),
            getMpdPort: jest.fn().mockReturnValue(6600),
          },
        },
      ],
    }).compile();

    service = module.get<MpdClientService>(MpdClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

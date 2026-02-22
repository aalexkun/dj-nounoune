import { GoogleGenAI } from '@google/genai';
import { ThrottleHandler } from './throttle.handler';
import { PromptusRequest } from '../request/promptus.request';

describe('ThrottleHandler', () => {
    let throttleHandler: ThrottleHandler;
    let clientMock: jest.Mocked<GoogleGenAI>;
    let requestMock: jest.Mocked<PromptusRequest<any>>;

    beforeEach(() => {
        clientMock = {} as any; // Not used directly in logic but required by constructor
        requestMock = {
            cache: undefined,
            context: 'Some context',
            query: 'A query',
            getContext: jest.fn().mockResolvedValue('Some context'),
        } as any;

        // Set a very small bucket for easy testing: 10 tokens per minute
        throttleHandler = new ThrottleHandler(clientMock, 10);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should allow requests if tokens are available', async () => {
        jest.spyOn(Buffer, 'byteLength').mockReturnValue(8); // 8 bytes = 1 token
        jest.useFakeTimers();

        const startTime = Date.now();
        await throttleHandler.acquireTokens(requestMock);
        const endTime = Date.now();

        // Should resolve immediately since bucket is full (10 tokens > 2 cost)
        expect(endTime - startTime).toBeLessThan(5);

        jest.useRealTimers();
    });

    it('should delay request if not enough tokens are available', async () => {
        // 1 token = 8 bytes. Let's make the cost 6 tokens (3 from query, 3 from context, total 6 bytes*8=48 bytes)
        jest.spyOn(Buffer, 'byteLength').mockReturnValue(24);
        jest.useFakeTimers();

        // First request will cost 6 tokens (Bucket: 10 -> 4)
        await throttleHandler.acquireTokens(requestMock);

        // Second request needs 6 tokens. Bucket only has 4. Deficit = 2.
        // Time to wait for 2 tokens = (2 / 10) * 60,000 = 12,000 ms.
        const promise = throttleHandler.acquireTokens(requestMock);

        // Advance time by 12 seconds
        jest.advanceTimersByTime(12000);

        await promise;

        // We reached here, means the promise resolved after 12 seconds
        expect(true).toBe(true);
        jest.useRealTimers();
    });
});

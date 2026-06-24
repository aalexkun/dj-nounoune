import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';




@Controller('auth')
export class AuthController {
  
  @Get('/spotify/callback')
  handleSpotifyCallback(@Query('code') code: string, @Res() res: Response) {
    if (!code) {
      return res.status(400).send('No code provided');
    }

    res.send(this.renderAuthCodePage(code));
  }
  
  @Get('/qobuz/callback')
  handleQobuzCallback(@Query('code_autorisation') codeAutorisation: string, @Res() res: Response) {
    if (!codeAutorisation) {
      return res.status(400).send('No code_autorisation provided');
    }

    res.send(this.renderAuthCodePage(codeAutorisation));
  }

  private renderAuthCodePage(authCode: string): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Authorization Code</title>
          <style>
              body {
                  margin: 0;
                  height: 100vh;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  background-color: #121212;
                  color: #e0e0e0;
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              }
              .discount-box {
                  background: #1e1e1e;
                  border: 2px dashed #4caf50;
                  border-radius: 12px;
                  padding: 40px;
                  text-align: center;
                  box-shadow: 0 8px 16px rgba(0,0,0,0.5);
                  max-width: 400px;
                  width: 100%;
              }
              h1 {
                  margin-top: 0;
                  font-size: 24px;
                  color: #ffffff;
              }
              .code-container {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: #2c2c2c;
                  padding: 15px;
                  border-radius: 8px;
                  margin: 20px 0;
                  cursor: pointer;
                  transition: background 0.2s;
              }
              .code-container:hover {
                  background: #383838;
              }
              .code {
                  font-size: 28px;
                  font-family: monospace;
                  font-weight: bold;
                  letter-spacing: 2px;
                  color: #4caf50;
                  margin-right: 15px;
                  word-break: break-all;
              }
              .copy-icon {
                  width: 24px;
                  height: 24px;
                  fill: #b0b0b0;
                  transition: fill 0.2s;
                  flex-shrink: 0;
              }
              .code-container:hover .copy-icon {
                  fill: #ffffff;
              }
              .instructions {
                  font-size: 14px;
                  color: #a0a0a0;
              }
              .toast {
                  position: fixed;
                  bottom: 30px;
                  background: #4caf50;
                  color: white;
                  padding: 10px 20px;
                  border-radius: 20px;
                  opacity: 0;
                  transition: opacity 0.3s;
                  pointer-events: none;
              }
              .toast.show {
                  opacity: 1;
              }
          </style>
      </head>
      <body>
          <div class="discount-box">
              <h1>Your Authorization Code</h1>
              <div class="code-container" onclick="copyCode()">
                  <span class="code" id="authCode">${authCode}</span>
                  <svg class="copy-icon" viewBox="0 0 24 24">
                      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                  </svg>
              </div>
              <p class="instructions">Click the code to copy it, then paste it back into your CLI to complete authentication.</p>
          </div>
          <div class="toast" id="toast">Copied to clipboard!</div>

          <script>
              function copyCode() {
                  const code = document.getElementById('authCode').innerText;
                  navigator.clipboard.writeText(code).then(() => {
                      const toast = document.getElementById('toast');
                      toast.classList.add('show');
                      setTimeout(() => {
                          toast.classList.remove('show');
                      }, 2000);
                  });
              }
          </script>
      </body>
      </html>
    `;
  }
}

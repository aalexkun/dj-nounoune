export abstract class MpdRequest<TResponse> {
  declare readonly _responseType: TResponse;

  abstract get command(): string;

  abstract get args(): string[];

  /**
   * Commands whose reply carries a raw byte payload (`albumart`, `readpicture`). The client keeps
   * those responses as a Buffer: decoding them as text would corrupt the picture, and the `OK\n`
   * that ends every other response can occur inside the bytes.
   */
  get isBinary(): boolean {
    return false;
  }

  /** Text commands are handed the decoded response, binary ones the untouched bytes. */
  abstract createResponse(raw: string | Buffer): TResponse;

  public getCommandString(): string {
    const args = this.args
      .map((arg) => {
        // Simple escaping for quotes if needed, though usually not complex in this limited scope
        // MPD protocol argument quoting: "arg"
        return `"${arg.replace(/"/g, '\\"')}"`;
      })
      .join(' ');

    // Handle commands with no args
    if (this.args.length === 0) {
      return `${this.command}\n`;
    }
    return `${this.command} ${args}\n`;
  }
}

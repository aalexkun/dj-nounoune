
export abstract class MpdRequest<TResponse> {
    declare readonly _responseType: TResponse;

    abstract get command(): string;

    abstract get args(): string[];

    abstract createResponse(raw: string): TResponse;

    public getCommandString(): string {
        const args = this.args.map(arg => {
            // Simple escaping for quotes if needed, though usually not complex in this limited scope
            // MPD protocol argument quoting: "arg"
            return `"${arg.replace(/"/g, '\\"')}"`;
        }).join(' ');

        // Handle commands with no args
        if (this.args.length === 0) {
            return `${this.command}\n`;
        }
        return `${this.command} ${args}\n`;
    }
}

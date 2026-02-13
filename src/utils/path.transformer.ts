export class PathTransformer {
  private readonly style: string;
  private readonly root: string;

  constructor(style: string, root: string) {
    this.style = style;
    this.root = root;
  }

  public transform(path: string): string {
    let normalized = path;

    // 1. Convert Windows backslashes to forward slashes if needed
    if (this.style === 'Windows') {
      normalized = normalized.replace(/\\/g, '/');
    }

    // 2. Normalize root for comparison (handle Windows root in env var)
    const normalizedRoot = this.style === 'Windows' ? this.root.replace(/\\/g, '/') : this.root;

    // 3. Remove the root path (case-insensitive check might be safer for Windows, but strict for now)
    // Note: If the path starts with the root, strip it.
    if (normalized.startsWith(normalizedRoot)) {
      normalized = normalized.substring(normalizedRoot.length);
    }

    return normalized;
  }
}

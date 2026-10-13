import type { PostProvider } from "./post-provider.js";

export class ProviderRegistry {
  constructor(private readonly provider?: PostProvider) {}

  get(): PostProvider | undefined {
    return this.provider;
  }
}

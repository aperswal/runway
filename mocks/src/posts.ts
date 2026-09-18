export type Network = 'x' | 'linkedin'
export type Post = { network: Network; text: string; image: number | null; receivedAt: string }

export class PostStore {
  private posts: Post[] = []

  add(post: Post): void {
    this.posts.push(post)
  }

  list(): Post[] {
    return [...this.posts]
  }

  byNetwork(network: Network): Post[] {
    return this.posts.filter((post) => post.network === network)
  }

  reset(): void {
    this.posts = []
  }
}

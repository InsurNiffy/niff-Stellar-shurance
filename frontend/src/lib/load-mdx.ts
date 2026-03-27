import { readFile } from 'fs/promises'
import path from 'path'
import { compileMDX } from 'next-mdx-remote/rsc'

const CONTENT_DIR = path.join(process.cwd(), 'src', 'content')

export async function loadMdx(slug: string) {
  const filePath = path.join(CONTENT_DIR, `${slug}.mdx`)
  const source = await readFile(filePath, 'utf8')
  return compileMDX({ source, options: { parseFrontmatter: false } })
}

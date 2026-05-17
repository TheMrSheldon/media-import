// ARD Sounds (formerly ARD Audiothek) GraphQL API — no auth required for public content.
// Endpoint confirmed via live schema introspection (May 2026).
const GRAPHQL_URL = 'https://api.ardaudiothek.de/graphql';

export interface ArdItem {
  id: string;
  title: string;
  summary: string;
  duration: number;       // seconds
  publishDate: string;    // ISO date string, e.g. "2024-03-15T10:00:00+01:00"
  imageUrl: string | null;
  downloadUrl: string | null;
  mimeType: string | null;
  showTitle: string | null;
  programSetId: string | null;
}

async function gqlPost(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`ARD Audiothek API: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`ARD Audiothek: ${json.errors[0].message}`);
  return json.data;
}

const ITEM_FIELDS = `
  id
  title
  summary
  duration
  publishDate
  image { url1X1 }
  audios { url downloadUrl mimeType allowDownload }
  programSet { id title }
`;

export async function searchArdAudiothek(query: string): Promise<ArdItem[]> {
  const data = (await gqlPost(
    `query Search($query: String!, $limit: Int) {
      search(query: $query, limit: $limit) {
        items { nodes { ${ITEM_FIELDS} } }
      }
    }`,
    { query, limit: 25 },
  )) as Record<string, unknown>;

  const nodes = ((data?.search as any)?.items?.nodes as unknown[]) ?? [];
  return nodes.map(nodeToItem);
}

export async function fetchProgramSetEpisodes(programSetId: string): Promise<ArdItem[]> {
  const data = (await gqlPost(
    `query ProgramSet($id: ID!) {
      programSet(id: $id) {
        items(orderBy: [EPISODE_NUMBER_ASC, PUBLISH_DATE_ASC]) {
          nodes { ${ITEM_FIELDS} }
        }
      }
    }`,
    { id: programSetId },
  )) as Record<string, unknown>;

  const nodes = ((data?.programSet as any)?.items?.nodes as unknown[]) ?? [];
  return nodes.map(nodeToItem).filter((item) => item.downloadUrl !== null);
}

function nodeToItem(n: unknown): ArdItem {
  const node = n as Record<string, unknown>;
  const audios = (node.audios as Record<string, unknown>[]) ?? [];
  // Prefer an audio that explicitly allows download; fall back to the first one.
  // downloadUrl is often null even for accessible content; url is always present.
  const audio = audios.find((a) => a.allowDownload !== false) ?? audios[0];
  const image = node.image as Record<string, unknown> | null;
  const programSet = node.programSet as Record<string, unknown> | null;

  // ARD image URLs contain a {width} template placeholder — replace with a concrete size.
  const rawImageUrl = (image?.url1X1 as string) ?? null;

  return {
    id: (node.id as string) ?? '',
    title: (node.title as string) ?? '',
    summary: (node.summary as string) ?? '',
    duration: (node.duration as number) ?? 0,
    publishDate: (node.publishDate as string) ?? '',
    imageUrl: rawImageUrl ? rawImageUrl.replace('{width}', '300') : null,
    downloadUrl: (audio?.downloadUrl as string) ?? (audio?.url as string) ?? null,
    mimeType: (audio?.mimeType as string) ?? null,
    showTitle: (programSet?.title as string) ?? null,
    programSetId: (programSet?.id as string) ?? null,
  };
}

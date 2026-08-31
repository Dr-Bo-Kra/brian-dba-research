import { handleVercelResearcherRequest } from './_vercel.mjs';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: 15,
};

export default async function handler(req, res) {
  await handleVercelResearcherRequest(req, res);
}

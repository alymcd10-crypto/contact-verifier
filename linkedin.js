// server/sources/linkedin.js — Fresh LinkedIn Profile Data via RapidAPI.
import { timedFetch } from './util.js';

const KEY = process.env.RAPIDAPI_KEY;
export const available = () => !!KEY;

export async function lookup(linkedinUrl) {
  if (!KEY || !linkedinUrl) return { source: 'linkedin', skipped: !KEY ? 'no-key' : 'no-url' };
  try {
    const r = await timedFetch(
      `https://fresh-linkedin-profile-data.p.rapidapi.com/get-linkedin-profile?linkedin_url=${encodeURIComponent(linkedinUrl)}&include_skills=false`,
      { headers: {
          'X-RapidAPI-Key': KEY,
          'X-RapidAPI-Host': 'fresh-linkedin-profile-data.p.rapidapi.com',
      } },
      12000,
    );
    if (!r.ok) return { source: 'linkedin' };
    const { data = {} } = await r.json();
    return {
      source: 'linkedin',
      photoUrl: data.profile_image_url || data.profile_pic_url || null,
      title: data.job_title || data.headline || null,
      company: data.company || data.company_name || null,
      address: [data.city, data.state, data.country].filter(Boolean).join(', ') || null,
      headline: data.headline || null,
      linkedinUrl,
    };
  } catch { return { source: 'linkedin' }; }
}

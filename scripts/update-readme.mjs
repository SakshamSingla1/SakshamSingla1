#!/usr/bin/env node
// Fetches live data from the portfolio API (portfoliosbuilder.com backend, resolved to
// Saksham's specific profile via the Referer header — the API is multi-tenant, keyed by
// the requesting domain) and regenerates the dynamic sections of README.md between
// marker comments. Run manually (`node scripts/update-readme.mjs`) or via the scheduled
// GitHub Action in .github/workflows/update-readme.yml.
//
// Exits 0 always; prints "README_CHANGED=true|false" as the last line so the calling
// workflow can decide whether to commit (avoids empty commits when nothing changed).

const API_URL = "https://api.portfoliosbuilder.com/api/v1/public/profile-master";
const REFERER = "https://www.sakshamsingla.com/";
const README_PATH = new URL("../README.md", import.meta.url);

const SKILL_CATEGORY_LABELS = {
  PROGRAMMING: "Languages",
  FRONTEND: "Frontend",
  BACKEND: "Backend & DevOps",
  DATABASE: "Databases",
  TOOL: "Tools",
};
// Render order for whichever categories are actually present in the API response.
const SKILL_CATEGORY_ORDER = ["PROGRAMMING", "FRONTEND", "BACKEND", "DATABASE", "TOOL"];

async function fetchProfile() {
  const res = await fetch(API_URL, { headers: { Referer: REFERER, Accept: "application/json" } });
  if (!res.ok) throw new Error(`profile-master fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.data ?? body;
}

// The CMS stores rich-text descriptions as simple, known-shape HTML (a wrapping <div>,
// <ul><li> bullets, <strong> emphasis) — not arbitrary markup — so a small targeted
// converter is safe here instead of pulling in a full HTML parser dependency.
function htmlToMarkdownBullets(html) {
  if (!html) return [];
  return html
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<strong>/gi, "**")
    .replace(/<\/strong>/gi, "**")
    .replace(/<em>/gi, "_")
    .replace(/<\/em>/gi, "_")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderSkills(skills) {
  const byCategory = new Map();
  for (const s of skills) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category).push(s);
  }
  const categories = [
    ...SKILL_CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !SKILL_CATEGORY_ORDER.includes(c)),
  ];
  return categories
    .map((cat) => {
      const label = SKILL_CATEGORY_LABELS[cat] ?? cat;
      const icons = byCategory
        .get(cat)
        .map((s) => `  <img src="${s.logoUrl}" title="${s.logoName}${s.level ? ` — ${s.level}` : ""}" width="40" />`)
        .join("\n");
      return `### ${label}\n<p>\n${icons}\n</p>`;
    })
    .join("\n\n");
}

function renderProjects(projects) {
  if (!projects?.length) return "_No public projects yet._";
  return projects
    .map((p) => {
      const bullets = htmlToMarkdownBullets(p.projectDescription).slice(0, 4); // keep it skimmable
      const stack = (p.skills ?? []).map((s) => s.logoName).join(", ");
      const links = [
        p.projectLink ? `[Live](${p.projectLink})` : null,
        ...(p.githubRepositories ?? []).map((repo, i) => `[Code${(p.githubRepositories.length > 1) ? ` (${i + 1})` : ""}](${repo})`),
      ].filter(Boolean).join(" · ");
      return [
        `#### ${p.projectName}`,
        "",
        ...bullets.map((b) => `${b}`),
        "",
        stack ? `**Stack:** ${stack}` : null,
        links ? `**Links:** ${links}` : null,
      ].filter((l) => l !== null).join("\n");
    })
    .join("\n\n---\n\n");
}

function renderExperience(experiences) {
  if (!experiences?.length) return "_No experience listed yet._";
  return experiences
    .map((e) => {
      const end = e.employmentStatus === "CURRENT" || !e.endDate ? "Present" : e.endDate;
      const bullets = htmlToMarkdownBullets(e.description).slice(0, 3);
      return [
        `**${e.jobTitle}** @ ${e.companyName} _(${e.startDate} – ${end})_`,
        ...bullets,
      ].join("\n");
    })
    .join("\n\n");
}

function spliceSection(readme, marker, content) {
  const start = `<!-- PORTFOLIO:${marker}:START -->`;
  const end = `<!-- PORTFOLIO:${marker}:END -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(readme)) {
    throw new Error(`Marker pair not found in README.md: ${start} / ${end}`);
  }
  return readme.replace(pattern, `${start}\n${content}\n${end}`);
}

async function main() {
  const fs = await import("node:fs/promises");
  const profile = await fetchProfile();

  let readme = await fs.readFile(README_PATH, "utf8");
  const original = readme;

  readme = spliceSection(readme, "SKILLS", renderSkills(profile.skills ?? []));
  readme = spliceSection(readme, "PROJECTS", renderProjects(profile.projects ?? []));
  readme = spliceSection(readme, "EXPERIENCE", renderExperience(profile.experiences ?? []));

  const changed = readme !== original;
  if (changed) {
    await fs.writeFile(README_PATH, readme, "utf8");
  }
  console.log(`Fetched profile for: ${profile.profile?.fullName ?? "unknown"}`);
  console.log(`README_CHANGED=${changed}`);
}

main().catch((err) => {
  console.error("update-readme failed:", err);
  process.exit(1);
});

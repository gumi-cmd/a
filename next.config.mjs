const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";

const nextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages && repositoryName ? `/${repositoryName}` : "",
  images: { unoptimized: true },
};

export default nextConfig;

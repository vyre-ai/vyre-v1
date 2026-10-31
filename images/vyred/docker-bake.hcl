// Multi-arch build of the vyred image. From the repo root:
//   docker buildx bake -f images/vyred/docker-bake.hcl            (load nothing, check both platforms build)
//   docker buildx bake -f images/vyred/docker-bake.hcl --push     (release)
variable "TAG" { default = "dev" }
variable "ENGINE_PACKAGES" { default = "@anthropic-ai/claude-code@2.1.316 @openai/codex@0.166.0" }
variable "REGISTRY" { default = "ghcr.io/vyre-ai" }

group "default" { targets = ["vyred"] }

target "vyred" {
  context    = "."
  dockerfile = "images/vyred/Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  args       = { ENGINE_PACKAGES = ENGINE_PACKAGES }
  tags       = ["${REGISTRY}/vyred:${TAG}"]
}

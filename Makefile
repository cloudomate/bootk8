# ─────────────────────────────────────────────────────────────────
# bootstrap-hci Makefile
# Builds custom K8s sysext + bootstrap container image
# ─────────────────────────────────────────────────────────────────

# ── Config — override via env or CLI ─────────────────────────────
REGISTRY        ?= ghcr.io/your-org/bootstrap-hci
DISTRO_VERSION  ?= hci-v1.31.0-1
FLATCAR_VERSION ?= 3975.2.2
ARCH            ?= amd64

# Paths
K8S_SRC_DIR     ?= ../kubernetes          # your K8s fork source
BIN_DIR         := bin
SYSEXT_DIR      := sysext
OUTPUT_DIR      := output

# Image tags
SYSEXT_IMAGE    := $(REGISTRY)/k8s-sysext:$(DISTRO_VERSION)
BOOTSTRAP_IMAGE := $(REGISTRY)/bootstrap:$(DISTRO_VERSION)

# ── Colours ───────────────────────────────────────────────────────
BOLD  := \033[1m
RESET := \033[0m
GREEN := \033[32m
BLUE  := \033[34m

.PHONY: all build push clean help \
        build-binaries build-sysext build-bootstrap \
        push-sysext push-bootstrap \
        test-local lint-ignition

# ── Default target ────────────────────────────────────────────────
all: build

help:
	@echo ""
	@echo "$(BOLD)bootstrap-hci build targets$(RESET)"
	@echo ""
	@echo "  $(BLUE)make build$(RESET)            Build everything (binaries → sysext → bootstrap)"
	@echo "  $(BLUE)make build-binaries$(RESET)   Compile custom K8s binaries from source"
	@echo "  $(BLUE)make build-sysext$(RESET)     Package binaries as a Flatcar sysext OCI image"
	@echo "  $(BLUE)make build-bootstrap$(RESET)  Build the bootstrap-hci container image"
	@echo "  $(BLUE)make push$(RESET)             Push all images to $(REGISTRY)"
	@echo "  $(BLUE)make test-local$(RESET)       Run bootstrap in local KVM test environment"
	@echo "  $(BLUE)make clean$(RESET)            Remove build artifacts"
	@echo ""
	@echo "$(BOLD)Variables$(RESET)"
	@echo "  DISTRO_VERSION  = $(DISTRO_VERSION)"
	@echo "  FLATCAR_VERSION = $(FLATCAR_VERSION)"
	@echo "  REGISTRY        = $(REGISTRY)"
	@echo "  K8S_SRC_DIR     = $(K8S_SRC_DIR)"
	@echo ""

# ── Build all ─────────────────────────────────────────────────────
build: build-binaries build-sysext build-bootstrap
	@echo "$(GREEN)✓ Full build complete: $(DISTRO_VERSION)$(RESET)"

# ── Step 1: Compile custom K8s binaries ──────────────────────────
build-binaries:
	@echo "$(BOLD)Building custom K8s binaries from $(K8S_SRC_DIR)...$(RESET)"
	@mkdir -p $(BIN_DIR)

	@# Build kubelet, kubeadm, kubectl from your K8s fork
	@# Adjust this target to match your repo's build system
	$(MAKE) -C $(K8S_SRC_DIR) \
		WHAT="cmd/kubelet cmd/kubeadm cmd/kubectl" \
		GOFLAGS=-v \
		GOARCH=$(ARCH)

	@# Copy binaries out
	cp $(K8S_SRC_DIR)/_output/bin/kubelet  $(BIN_DIR)/kubelet
	cp $(K8S_SRC_DIR)/_output/bin/kubeadm  $(BIN_DIR)/kubeadm
	cp $(K8S_SRC_DIR)/_output/bin/kubectl  $(BIN_DIR)/kubectl
	chmod +x $(BIN_DIR)/*

	@echo "$(GREEN)✓ Binaries built$(RESET)"
	@ls -lh $(BIN_DIR)/

# ── Step 2: Package as Flatcar sysext OCI image ──────────────────
build-sysext: $(BIN_DIR)/kubelet $(BIN_DIR)/kubeadm $(BIN_DIR)/kubectl
	@echo "$(BOLD)Packaging sysext: $(SYSEXT_IMAGE)$(RESET)"

	@# Build the sysext directory layout
	@rm -rf $(SYSEXT_DIR)
	@mkdir -p $(SYSEXT_DIR)/usr/bin
	@mkdir -p $(SYSEXT_DIR)/usr/lib/extension-release.d

	@# Copy binaries
	cp $(BIN_DIR)/kubelet  $(SYSEXT_DIR)/usr/bin/kubelet
	cp $(BIN_DIR)/kubeadm  $(SYSEXT_DIR)/usr/bin/kubeadm
	cp $(BIN_DIR)/kubectl  $(SYSEXT_DIR)/usr/bin/kubectl
	chmod +x $(SYSEXT_DIR)/usr/bin/*

	@# Write sysext metadata
	@echo "ID=flatcar"                         > $(SYSEXT_DIR)/usr/lib/extension-release.d/extension-release.kubernetes
	@echo "SYSEXT_LEVEL=1"                    >> $(SYSEXT_DIR)/usr/lib/extension-release.d/extension-release.kubernetes
	@echo "VERSION=$(DISTRO_VERSION)"         >> $(SYSEXT_DIR)/usr/lib/extension-release.d/extension-release.kubernetes
	@echo "DISTRO_NAME=bootstrap-hci"         >> $(SYSEXT_DIR)/usr/lib/extension-release.d/extension-release.kubernetes

	@# Build OCI image from scratch
	docker build \
		--no-cache \
		-f Dockerfile.sysext \
		-t $(SYSEXT_IMAGE) \
		.

	@echo "$(GREEN)✓ Sysext image built: $(SYSEXT_IMAGE)$(RESET)"

# ── Step 3: Build bootstrap container ────────────────────────────
build-bootstrap:
	@echo "$(BOLD)Building bootstrap image: $(BOOTSTRAP_IMAGE)$(RESET)"

	docker build \
		--no-cache \
		--build-arg FLATCAR_VERSION=$(FLATCAR_VERSION) \
		--build-arg DISTRO_VERSION=$(DISTRO_VERSION) \
		--build-arg SYSEXT_IMAGE=$(SYSEXT_IMAGE) \
		-f Dockerfile \
		-t $(BOOTSTRAP_IMAGE) \
		.

	@echo "$(GREEN)✓ Bootstrap image built: $(BOOTSTRAP_IMAGE)$(RESET)"

# ── Push targets ──────────────────────────────────────────────────
push: push-sysext push-bootstrap
	@echo "$(GREEN)✓ All images pushed to $(REGISTRY)$(RESET)"

push-sysext:
	@echo "Pushing $(SYSEXT_IMAGE)..."
	docker push $(SYSEXT_IMAGE)

push-bootstrap:
	@echo "Pushing $(BOOTSTRAP_IMAGE)..."
	docker push $(BOOTSTRAP_IMAGE)

# ── Local KVM test ────────────────────────────────────────────────
test-local: build
	@echo "$(BOLD)Starting local KVM test environment...$(RESET)"
	@[ -f cluster.yaml ] || (echo "ERROR: cluster.yaml not found. Copy cluster.yaml.example first."; exit 1)
	@mkdir -p $(OUTPUT_DIR)

	@# Set up KVM bridge network
	@virsh net-info pxe-net >/dev/null 2>&1 || \
		virsh net-define tests/pxe-net.xml && \
		virsh net-start pxe-net

	@# Create VMs from cluster.yaml
	bash tests/create-vms.sh cluster.yaml

	@# Run bootstrap container
	docker run --rm \
		--net=host \
		--privileged \
		-v $(PWD)/cluster.yaml:/config/cluster.yaml:ro \
		-v $(PWD)/$(OUTPUT_DIR):/output \
		$(BOOTSTRAP_IMAGE) init

# ── Validate Ignition templates ───────────────────────────────────
lint-ignition:
	@echo "Linting Ignition templates..."
	@for tmpl in templates/ignition/*.yaml.tmpl; do \
		echo "  Checking $$tmpl..."; \
		envsubst < $$tmpl | butane --strict --files-dir . - > /dev/null && \
		echo "  ✓ $$tmpl"; \
	done
	@echo "$(GREEN)✓ All templates valid$(RESET)"

# ── Clean ─────────────────────────────────────────────────────────
clean:
	rm -rf $(BIN_DIR) $(SYSEXT_DIR) $(OUTPUT_DIR)
	@echo "$(GREEN)✓ Clean$(RESET)"

# ─────────────────────────────────────────────
# Stage 1: Download tools
# ─────────────────────────────────────────────
FROM alpine:3.19 AS downloader

ARG MATCHBOX_VERSION=0.10.0
ARG BUTANE_VERSION=0.20.0
ARG KUBECTL_VERSION=v1.31.0
ARG FLATCAR_VERSION=3975.2.2

RUN apk add --no-cache curl

WORKDIR /downloads

# Matchbox
RUN curl -fsSLo matchbox.tar.gz \
    https://github.com/poseidon/matchbox/releases/download/v${MATCHBOX_VERSION}/matchbox-v${MATCHBOX_VERSION}-linux-amd64.tar.gz && \
    tar -xzf matchbox.tar.gz && \
    mv matchbox-v${MATCHBOX_VERSION}-linux-amd64/matchbox /usr/local/bin/matchbox && \
    chmod +x /usr/local/bin/matchbox

# Butane (Ignition config transpiler)
RUN curl -fsSLo /usr/local/bin/butane \
    https://github.com/coreos/butane/releases/download/v${BUTANE_VERSION}/butane-x86_64-unknown-linux-gnu && \
    chmod +x /usr/local/bin/butane

# kubectl (for cluster health checks)
RUN curl -fsSLo /usr/local/bin/kubectl \
    https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl && \
    chmod +x /usr/local/bin/kubectl

# Flatcar PXE assets
RUN mkdir -p /flatcar-assets/${FLATCAR_VERSION} && \
    BASE=https://stable.release.flatcar-linux.net/amd64-usr/${FLATCAR_VERSION} && \
    curl -fsSLo /flatcar-assets/${FLATCAR_VERSION}/flatcar_production_pxe.vmlinuz \
        ${BASE}/flatcar_production_pxe.vmlinuz && \
    curl -fsSLo /flatcar-assets/${FLATCAR_VERSION}/flatcar_production_pxe_image.cpio.gz \
        ${BASE}/flatcar_production_pxe_image.cpio.gz

# ─────────────────────────────────────────────
# Stage 2: Final image
# ─────────────────────────────────────────────
FROM alpine:3.19

LABEL org.opencontainers.image.title="K8s Distro Bootstrap Node"
LABEL org.opencontainers.image.description="Matchbox + dnsmasq bootstrap node for bare metal Flatcar K8s"
LABEL org.opencontainers.image.source="https://github.com/your-org/your-distro"

ARG FLATCAR_VERSION=3975.2.2
ENV FLATCAR_VERSION=${FLATCAR_VERSION}

# Runtime dependencies
RUN apk add --no-cache \
    dnsmasq \
    bash \
    curl \
    jq \
    gettext \
    iproute2 \
    iputils \
    openssl \
    tftp-hpa

# Copy tools from downloader stage
COPY --from=downloader /usr/local/bin/matchbox  /usr/local/bin/matchbox
COPY --from=downloader /usr/local/bin/butane    /usr/local/bin/butane
COPY --from=downloader /usr/local/bin/kubectl   /usr/local/bin/kubectl

# Copy Flatcar PXE assets
COPY --from=downloader /flatcar-assets /var/lib/matchbox/assets/flatcar

# Copy scripts and templates
COPY scripts/     /usr/local/bin/
COPY templates/   /templates/

# iPXE bootloader for TFTP
RUN mkdir -p /var/lib/tftpboot && \
    curl -fsSLo /var/lib/tftpboot/undionly.kpxe \
        http://boot.ipxe.org/undionly.kpxe

# Matchbox data directory
RUN mkdir -p /var/lib/matchbox/{profiles,groups,ignition}

# Make all scripts executable
RUN chmod +x /usr/local/bin/*.sh

VOLUME ["/config"]
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["--help"]

-- CreateTable
CREATE TABLE "DnsCache" (
    "id" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "records" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DnsCache_domainName_key" ON "DnsCache"("domainName");

-- CreateIndex
CREATE INDEX "DnsCache_domainName_idx" ON "DnsCache"("domainName");

import { createSignal, onMount } from "solid-js";
//import { useNavigate } from "@solidjs/router"; // Ensure this is used within a router context
import {
  Lucid,
  LucidEvolution,
  UTxO,
  Blockfrost,
} from "@lucid-evolution/lucid";
import { calculateFingerprint } from "./utils/fingerprint";

type NFT = {
  policyId: string;
  assetName: string;
  assetNameHex: string;
  unit: string;
  fingerprint: string;
};

function App() {
  const [lucid, setLucid] = createSignal<LucidEvolution | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [walletUtxos, setWalletUtxos] = createSignal<UTxO[]>([]);
  const [nfts, setNfts] = createSignal<NFT[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [errors, setErrors] = createSignal("");
  //const navigate = useNavigate(); // Use navigate within a router context

  // Initialize Lucid Evolution
  onMount(async () => {
    try {
      const lucidInstance = await Lucid(
        new Blockfrost(
          "https://cardano-preprod.blockfrost.io/api/v0",
          "preprodYGEhAAzZKRY21n2a98ED6oBZteeXco8p"
        ),
        "Preprod"
      );
      setLucid(lucidInstance);
    } catch (err) {
      setErrors((err as Error)?.message || "Failed to initialize Lucid");
    }
  });

  // Connect to the wallet
  async function connectWallet() {
    try {
      const walletApi = await window.cardano?.eternl?.enable();
      if (!walletApi) throw new Error("No wallet found");

      const lucidInstance = lucid();
      if (!lucidInstance) throw new Error("Lucid not initialized");

      lucidInstance.selectWallet.fromAPI(walletApi);
      const utxos = await lucidInstance.wallet().getUtxos();
      setWalletUtxos(utxos || []);
      setConnected(true);
    } catch (err) {
      setErrors((err as Error)?.message || "Failed to connect wallet");
    }
  }

  // Fetch wallet NFTs
  async function getNFTs() {
    try {
      setLoading(true);
      setErrors("");
      const utxos = walletUtxos();

      // Extract NFTs from UTxOs
      const fetchedNFTs: NFT[] = [];

      utxos.forEach((utxo) => {
        Object.entries(utxo.assets).forEach(([unit, quantity]) => {
          // NFTs typically have a quantity of 1
          if (quantity.toString() !== "1") return;

          // Skip ADA (lovelace)
          if (unit === "lovelace") return;

          const policyId = unit.slice(0, 56);
          const assetNameHex = unit.slice(56);

          // Skip if no asset name
          if (!assetNameHex) return;

          // Decode asset name from hex to UTF-8
          let assetName;
          try {
            const buffer = Buffer.from(assetNameHex, "hex");
            assetName = buffer.toString("utf-8");

            // If the result contains non-printable characters, use hex representation
            if (!/^[\x20-\x7E]*$/.test(assetName)) {
              assetName = assetNameHex + " (hex)";
            }
          } catch (e) {
            assetName = assetNameHex + " (hex)";
          }

          // Calculate fingerprint
          const fingerprint = calculateFingerprint(policyId, assetNameHex);

          fetchedNFTs.push({
            policyId,
            assetName,
            assetNameHex,
            unit,
            fingerprint,
          });
        });
      });

      setNfts(fetchedNFTs);
      setLoading(false);
    } catch (err) {
      setErrors((err as Error)?.message || "Failed to fetch NFTs");
      setLoading(false);
    }
  }

  return (
    <div class="bg-gray-900 min-h-screen w-full text-white text-center">
      <header class="p-4">
        <h1 class="text-6xl font-thin mb-10 pt-6">Lucid Evolution NFT Viewer</h1>
      </header>
      <main class="flex flex-col items-center justify-center p-6">
        {!connected() ? (
          <button
            onClick={connectWallet}
            class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg text-xl transition-colors"
          >
            Connect Wallet
          </button>
        ) : (
          <>
            <h2 class="text-3xl font-thin mb-6">Wallet Connected</h2>
            <button
              onClick={getNFTs}
              disabled={loading()}
              class={`px-6 py-3 rounded-lg text-xl transition-colors ${
                loading() ? "bg-gray-500" : "bg-green-500 hover:bg-green-600"
              }`}
            >
              {loading() ? "Loading..." : "Get My NFTs"}
            </button>

            {nfts().length > 0 ? (
              <div class="mt-10 w-full max-w-4xl">
                <h3 class="text-2xl font-thin mb-6">Your NFTs ({nfts().length})</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {nfts().map((nft, index) => (
                    <div class="bg-gray-800 p-4 rounded-lg text-left">
                      <span class="flex flex-col items-center">{index}</span>
                      <div class="text-xl font-semibold text-green-400">{nft.assetName}</div>
                      <div class="text-sm text-gray-400 mt-2">
                        <div class="mb-1">
                          <span class="text-gray-300">Policy ID:</span> {nft.policyId.slice(0, 8)}...{nft.policyId.slice(-8)}
                        </div>
                        <div class="mb-1">
                          <span class="text-gray-300">Fingerprint:</span> {nft.fingerprint}
                        </div>
                        <div class="mb-1">
                          <span class="text-gray-300">Asset ID:</span> {nft.unit.slice(0, 8)}...{nft.unit.slice(-8)}
                        </div>
                      </div>
                      <div class="mt-4">
                        <a
                          href={`/contract/${nft.fingerprint}/list/33`}
                          class="text-sky-400 hover:text-sky-300 transition-colors"
                        >
                          List via Beacons
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : !loading() && (
              <div class="mt-10 text-xl text-gray-400">
                {errors() ? "Error loading NFTs" : "No NFTs found in your wallet"}
              </div>
            )}
          </>
        )}
        {errors() && (
          <div class="text-red-500 mt-6 p-4 bg-red-900 bg-opacity-30 rounded-lg max-w-xl">
            <strong>Error:</strong> {errors()}
          </div>
        )}
      </main>
    </div>
    
  );
}

export default App;
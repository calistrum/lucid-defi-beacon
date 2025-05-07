import { createSignal, onMount } from "solid-js";
import { useParams } from "@solidjs/router"; // Updated router import
import { Lucid, LucidEvolution, Blockfrost, Wallet } from "@lucid-evolution/lucid";
import { createSpotSaleLucid } from "../p2p_aftermarket_lucid.ts";
import { calculateFingerprint } from "../utils/fingerprint.js";

function ContractPage() {
  const params = useParams();
  const { fingerprint, action, quantity } = params;
  const quantityAsNumber = quantity ? Number(params.quantity) : 0; // Parse quantity as a number

  const [lucid, setLucid] = createSignal<LucidEvolution | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [wallet, setWallet] = createSignal<Wallet | null>(null);
  const [actionStatus, setActionStatus] = createSignal("");
  const [loading, setLoading] = createSignal(false);

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
      console.error("Failed to initialize Lucid:", err);
      setActionStatus("Failed to connect to Cardano network. Please try again later.");
    }
  });

  // Connect to the wallet with better error handling
  async function connectWallet() {
    setLoading(true);
    try {
      // Try Eternl first
      let walletApi = null;
      
      if (window.cardano?.eternl) {
        walletApi = await window.cardano.eternl.enable();
      } else if (window.cardano?.nami) {
        walletApi = await window.cardano.nami.enable();
      } else if (window.cardano?.flint) {
        walletApi = await window.cardano.flint.enable();
      }
      
      if (!walletApi) throw new Error("No compatible wallet found. Please install Eternl, Nami, or Flint.");
      
      const lucidInstance = lucid();
      if (!lucidInstance) throw new Error("Lucid not initialized");
      
      lucidInstance.selectWallet.fromAPI(walletApi);
      
      setWallet(lucidInstance.wallet());
      setConnected(true);
      setActionStatus("");
    } catch (err) {
      console.error("Failed to connect wallet:", err);
      setActionStatus(`Wallet connection failed: ${err || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  // List Asset Handler with improved error handling
  const listAssetHandler = async () => {
    setLoading(true); // Set loading to true at the start
    try {
      if (!wallet()) {
        setActionStatus("Wallet is not connected");
        setLoading(false); // Reset loading if wallet is not connected
        return;
      }

      // Fetch UTxOs from the wallet
      const utxos = await wallet()?.getUtxos();

      // Extract NFTs from UTxOs
      let foundNFT: {
        policyId: string;
        assetName: string;
        assetNameHex: string;
        unit: string;
        fingerprint: string;
      } | null = null as {
        policyId: string;
        assetName: string;
        assetNameHex: string;
        unit: string;
        fingerprint: string;
      } | null;
      utxos?.forEach((utxo) => {
        Object.entries(utxo.assets).forEach(([unit, quantity]) => {
          if (quantity.toString() !== "1") return; // NFTs typically have a quantity of 1
          if (unit === "lovelace") return; // Skip ADA (lovelace)

          const policyId = unit.slice(0, 56);
          const assetNameHex = unit.slice(56);
          if (!assetNameHex) return;

          const fingerprintCalculated = calculateFingerprint(policyId, assetNameHex);
          if (fingerprintCalculated === fingerprint) {
            foundNFT = {
              policyId,
              assetName: Buffer.from(assetNameHex, "hex").toString("utf-8"),
              assetNameHex,
              unit,
              fingerprint: fingerprintCalculated,
            };
          }
        });
      });

      if (!foundNFT) {
        setActionStatus(`Asset with fingerprint ${fingerprint} not found in your wallet`);
        setLoading(false); // Reset loading if NFT is not found
        return;
      }

      const quantityAsNumber = quantity ? Number(quantity) * 1_000_000 : null;
      if (!quantityAsNumber || isNaN(quantityAsNumber)) {
        setActionStatus("Invalid quantity specified for listing");
        setLoading(false); // Reset loading if quantity is invalid
        return;
      }

      const paymentAddress = await wallet()?.address();
      const deposit = 5_000_000; // Fixed deposit amount in lovelaces
      const prices = [
        {
          currencySymbol: foundNFT.policyId,
          tokenName: foundNFT.assetName,
          amount: quantityAsNumber,
        },
      ];

      setActionStatus("Preparing transaction... Please sign with your wallet when prompted.");
      const lucidInstance = lucid();
      if (!lucidInstance) {
        setActionStatus("Lucid instance is not initialized.");
        setLoading(false);
        return;
      }
      if (!paymentAddress) {
        setActionStatus("Payment address is undefined. Please ensure your wallet is connected properly.");
        setLoading(false);
        return;
      }
      await createSpotSaleLucid(lucidInstance, [foundNFT], paymentAddress, BigInt(deposit), prices);
      setActionStatus("Listing successful!");
    } catch (err) {
      console.error("Error listing asset:", err);
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during the listing process.";
      setActionStatus(`Error: ${errorMessage}`);
    } finally {
      setLoading(false); // Ensure loading is reset in the finally block
    }
  };

  // Render the appropriate panel based on the action
  const renderPanel = () => {
    if (action === "list") {
      return (
        <ListingPanel
          fingerprint={fingerprint} // Ensure quantity is a number
          quantity={quantityAsNumber}
          listAssetHandler={listAssetHandler}
          actionStatus={actionStatus()}
          loading={loading()}
        />
      );
    } else {
      return <div class="notification is-warning">No valid action provided. Please check the URL parameters.</div>;
    }
  };

  return (
    <div class="is-fullheight">
      <nav class="navbar has-shadow">
        <div class="container">
          <div class="navbar-brand">
            <a class="navbar-item" href="/">
              <span class="title is-size-3" style={{ color: "#3e8ed0" }}>NFTI/O</span>
            </a>
          </div>
          <div class="navbar-end">
            {!connected() ? (
              <button 
                class={`button is-info ${loading() ? 'is-loading' : ''}`} 
                onClick={connectWallet} 
                disabled={loading()}
              >
                Connect Wallet
              </button>
            ) : (
              <span class="navbar-item has-text-success">
                <span class="icon mr-2">
                  <i class="fas fa-check-circle"></i>
                </span>
                Wallet Connected
              </span>
            )}
          </div>
        </div>
      </nav>

      <main class="section">
        {connected() ? renderPanel() : (
          <div class="container box">
            <p>Please connect your Cardano wallet to proceed with your {action} operation.</p>
            {actionStatus() && <div class="notification is-danger is-light mt-3">{actionStatus()}</div>}
          </div>
        )}
      </main>
    </div>
  );
}

interface ListingPanelProps {
  fingerprint: string;
  quantity: number;
  listAssetHandler: () => void;
  actionStatus: string;
  loading: boolean;
}

function ListingPanel({ fingerprint, quantity, listAssetHandler, actionStatus, loading }: ListingPanelProps) {
  return (
    <div class="panel container box is-fullwidth is-fullheight is-info">
      <p class="panel-heading mb-4">Please confirm the listing by signing with your wallet:</p>
      <div class="columns is-mobile is-flex is-align-items-start">
        <div class="column is-3-desktop is-3-tablet is-half-mobile">
          <div class="card is-shady">
            <div class="box">
              <figure class="image is-square">
                <img
                  src={`https://cdn.nftio.io/cdn/${fingerprint}.webp`}
                  alt="NFT Preview"
                  loading="lazy"
                  style={{ "border-radius": "6px" }}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = "/placeholder-nft.png"; // Set fallback image
                    target.onerror = null; // Remove the onError handler to prevent infinite loop
                  }}
                />
              </figure>
            </div>
          </div>
        </div>

        <div class="column is-half-mobile">
          <p>
            <span class="has-text-info is-size-5">Fees: 0.5% with a minimum of 1₳.</span>
          </p>
          <p>
            <span class="is-size-6">
              By listing the asset for sale, you will place it in the marketplace smart contract. When someone
              purchases it, the funds will be automatically sent to your wallet.
            </span>
          </p>
          <br />
          <p style={{ "word-wrap": "break-word" }}>
            NFT:&nbsp;&nbsp;&nbsp;
            <a
              style={{ color: "#3e8ed0" }}
              href={`https://nftio.io/asset/${fingerprint}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {fingerprint}
            </a>
          </p>
          <p>Price: ₳{quantity}</p>
          <br />
          {actionStatus === "" ? (
            <button 
              type="button" 
              class={`button is-info ${loading ? 'is-loading' : ''}`} 
              onClick={listAssetHandler}
              
            >
              List for Sale
            </button>
          ) : actionStatus.includes("successful") ? (
            <div class="notification is-success is-light">
              <p>{actionStatus}</p>
              <p class="mt-3">Your asset is now deployed in the smart contract.</p>
            </div>
          ) : (
            <div class="notification is-danger is-light">{actionStatus}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ContractPage;

// function createSpotSale(arg0: Wallet | null, arg1: never[], paymentAddress: string | undefined, deposit: number, price: {
//     policyId: string; // Empty for ADA
//     assetName: string; quantity: number;
// }[]) {
//     console.log("Function not implemented.");
// }

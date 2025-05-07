// Import required Lucid components and other libraries
import {
    LucidEvolution, 
    Data,
    Constr,
    fromHex,
    toHex,
    fromText,
    getAddressDetails,
    TxHash,
    PolicyId,
    Address,
    validatorToAddress
  } from "@lucid-evolution/lucid";
  import crypto from "crypto";
  
  // ===============================
  // Type Definitions
  // ===============================
  
  interface ScriptRef {
    txHash: TxHash;
    outputIndex: number;
    size?: number; // Optional size for reference script
  }
  
const BEACON_POLICY_PREFIX = "00";

  // Script References (UTxO locations) - Ensure these are correct for Preprod
const SCRIPT_REFS = {
    // PROXY: { // Example if needed
    //   txHash: "6c402050892c8cb0e3e54f803d7ae292d6f5f90745b7f76722f7c303c7085d50",
    //   outputIndex: 0,
    // },
    BEACON: {
      txHash: "6c402050892c8cb0e3e54f803d7ae292d6f5f90745b7f76722f7c303c7085d50",
      outputIndex: 0,
    },
    AFTERMARKET: {
      txHash: "e95a73a1e03afdf74b86d10e504b64285f7afdfab7f7021a41054ae4b377ca9f",
      outputIndex: 0,
    },
    // AFTERMARKET_OBSERVER: { // Add if needed for reading
    //   txHash: "b6b5bd23fa762b2630dc9dedc10d0bac61d6ffa3617f451df8a8ee31a83c441f",
    //   outputIndex: 0,
    // }
};

const SCRIPT_HASHES = {
    PROXY: 'bdceb595b8754726b3efe3ab0f81c76cbda1a0a0d3653bb8fad89bb2',                  // Proxy script hash (Needed if used in Addresses)
    AFTERMARKET: 'e07ee8979776692ce3477b0c0d53b4c650ef6ccad75c2596da22847c',            // Aftermarket script hash (Used for seller address)
    AFTERMARKET_OBSERVER: '3e5528d9a7610aa5459a7deed9d3c1c2ee8b0310fae6642df4c37213',   // Aftermarket observer script hash (Used in datum)
    BEACON: 'bdceb595b8754726b3efe3ab0f81c76cbda1a0a0d3653bb8fad89bb2'                  // Beacon script hash (Used for minting policy ID)
};

// Currency Symbols
const CURRENCY_SYMBOLS = {
    // Policy ID derived from the Beacon script hash
    BEACON: SCRIPT_HASHES.BEACON,
};

// Beacon Names (as Text)
const BEACON_NAMES = {
    SPOT: 'Spot',
    AUCTION: 'Auction', // Not used here
    BID: 'Bid'          // Not used here
};

// ===============================
// Lucid Data Type Definitions (using Data alias)
// ===============================


// Function to create the SpotDatum PlutusData object
const SpotDatumData = (datum: any) => {
    if (!Array.isArray(datum.nftNames)) throw new Error("nftNames must be an array");
    //if (!Array.isArray(datum.salePrice)) throw new Error("salePrice must be an array");

    const nftNamesPlutus = datum.nftNames.map((name: any) => (name));
    // Convert salePrice to a proper list of Price Constructors
    const salePricePlutus = datum.salePrice.map((p:any) => 
        new Constr(0, [
            //p.currencySymbol === '' ? '' : (p.currencySymbol),
            //p.tokenName === '' ? '' : (p.tokenName),
            BigInt(p.amount)
        ])
    );

    return new Constr(0, [
        datum.beaconId,
        datum.aftermarketObserverHash,
        datum.nftPolicyId,
        nftNamesPlutus,
        datum.paymentAddress, // Already properly constructed Plutus Address Data
        BigInt(datum.saleDeposit),
        salePricePlutus
    ]);
};


const CreateCloseOrUpdateMarketUTxOsRedeemer = () => new Constr(0, [BigInt(8166)]);


  // ===============================
  // Helper Functions
  // ===============================
  
  function sha256Node(data: Uint8Array | Buffer): Uint8Array {
    const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const hash = crypto.createHash("sha256");
    hash.update(bufferData);
    const hashBuffer = hash.digest();
    return new Uint8Array(hashBuffer.buffer, hashBuffer.byteOffset, hashBuffer.byteLength);
  }
  
  function getScriptRef(scriptType: keyof typeof SCRIPT_REFS): ScriptRef {
    const ref = SCRIPT_REFS[scriptType];
    if (!ref) {
      throw new Error(`Unknown script reference for type: ${scriptType}`);
    }
    return {
      txHash: ref.txHash,
      outputIndex: ref.outputIndex,
    };
  }
  
  function genPolicyBeaconNameHex(policyId: PolicyId): string {
    const prefixBytes = fromHex(BEACON_POLICY_PREFIX);
    const policyIdBytes = fromHex(policyId);
    const combined = new Uint8Array(prefixBytes.length + policyIdBytes.length);
    combined.set(prefixBytes, 0);
    combined.set(policyIdBytes, prefixBytes.length);
  
    const hashedBytes = sha256Node(combined);
    return toHex(hashedBytes);
  }
  
  function bech32ToPlutusAddressData(bech32Address: Address): Constr<unknown> {
    const { paymentCredential, stakeCredential } = getAddressDetails(bech32Address);
  
    if (!paymentCredential) {
      throw new Error(`Could not extract payment credential from address: ${bech32Address}`);
    }
  
    let paymentConstr: Constr<unknown>;
    if (paymentCredential.type === "Key") {
      paymentConstr = new Constr(0, [paymentCredential.hash]); // PubKeyCredential
    } else {
      paymentConstr = new Constr(1, [paymentCredential.hash]); // ScriptCredential
    }
  
    let stakeConstr: Constr<unknown>;
    if (stakeCredential) {
      const stakeCredConstr = stakeCredential.type === "Key"
        ? new Constr(0, [stakeCredential.hash])
        : new Constr(1, [stakeCredential.hash]);
      stakeConstr = new Constr(0, [new Constr(0, [stakeCredConstr])]);
    }else{
        stakeConstr = new Constr(0, []);
    }
  
    return new Constr(0, [paymentConstr, stakeConstr]);
  }
  
  /**
   * Generate the seller's smart contract address.
   * @param {Lucid} lucid - Initialized Lucid instance.
   * @param {Address} rewardAddress - The seller's reward address (Bech32).
   * @returns {Address} - The generated smart contract address (Bech32).
   */
  function genSellerAddress(lucid: LucidEvolution, rewardAddress: Address): Address | null {
      const aftermarketScriptHash = getScriptHash('AFTERMARKET');
  
      // Extract the staking credential hash from the reward address
      const { stakeCredential } = getAddressDetails(rewardAddress);
  
      if (!stakeCredential) {
          // Handle case where the reward address has no staking part (rare for user wallets)
          // Or decide if a default/no staking part is acceptable for the contract address
          console.warn(`Reward address ${rewardAddress} has no stake credential.`);
      }
      else{
          // Build the address using the script hash for payment and user's hash for staking
          const spend_val = {
              type: "PlutusV2" as const,
              script: aftermarketScriptHash, 
            };
             
          const network = lucid.config().network;
          if (!network) {
              throw new Error("Lucid network configuration is undefined.");
          }
          const sellerAddress = validatorToAddress(network, spend_val, stakeCredential);
          
          return sellerAddress;
      }
      return null;
  }
  // ===============================
  // Main Function
  // ===============================

/**
 * Creates a Spot UTxO for selling NFTs using Lucid.
 * @param {walletApi} lucid - Initialized Lucid instance with wallet connected.
 * @param {Array<{policyId: PolicyId, assetName: string}>} nfts - Array of NFTs to sell (assetName assumed hex).
 * @param {Address} sellerPaymentAddress - The seller's own address where proceeds eventually go (used in Datum).
 * @param {bigint | number} deposit - Lovelace deposit amount for the UTxO.
 * @param {Array<{currencySymbol: PolicyId | '', tokenName: string, amount: bigint | number}>} price - Sale price (tokenName assumed hex, '' CS for lovelace).
 * @returns {Promise<TxHash>} - The hash of the submitted transaction.
 */
export async function createSpotSaleLucid(lucid:LucidEvolution, nfts: any[], sellerPaymentAddress: string, deposit: string | number | bigint | boolean, price: any[]) {
    console.log("--- Starting createSpotSaleLucid ---");
    try {
        if (!lucid) throw new Error("Lucid instance is not initialized.");
        const wallet = lucid.wallet(); // Get the connected wallet instance

        if (!wallet) throw new Error("Wallet not connected in Lucid.");
        
        if (!nfts || nfts.length === 0) throw new Error("NFTs array cannot be empty.");

        const sellerWalletAddress = await wallet.address(); // Address for signing, change, etc.
        const sellerRewardAddress = await wallet.rewardAddress(); // Assume first reward address
         if (!sellerRewardAddress) {
             throw new Error("Could not get reward address from wallet. Needed for seller script address.");
         }
        console.log("Seller Wallet Address:", sellerWalletAddress);
        console.log("Seller Reward Address:", sellerRewardAddress);

        // 1. Prepare Datum Inputs
        const nftPolicyId = nfts[0].policyId;
        
        const nftNamesHex = nfts.map(nft => fromText(nft.assetName)); 
    


        // Convert price amounts to BigInt
        const salePrice = price.map(p => ({
            //currencySymbol: p.policyId === '' ? '' : p.policyId, 
            //tokenName: p.assetName === '' ? '' : fromText(p.assetName),
            amount: BigInt(p.amount) // Convert to BigInt
        }));

        // Convert sellerPaymentAddress (where buyer sends payment eventually) to Plutus Data
        const paymentAddressPlutusData = bech32ToPlutusAddressData(sellerPaymentAddress);

        // Assemble the datum object
        const spotDatumObject = {
            beaconId: getCurrencySymbol('BEACON'),
            aftermarketObserverHash: getScriptHash('AFTERMARKET_OBSERVER'),
            nftPolicyId: nftPolicyId,
            nftNames: nftNamesHex,
            paymentAddress: paymentAddressPlutusData, // Use the converted Plutus Data
            saleDeposit: BigInt(deposit),
            salePrice: salePrice
        };
        
        console.log("Spot Datum Object (JS):", JSON.stringify(spotDatumObject, (_, value) =>
            typeof value === 'bigint' ? value.toString() + 'n' : value // BigInt serializer
        , 2));

        // Create the final PlutusData structure for the datum
        const datumData = SpotDatumData(spotDatumObject);
        const datumCbor = Data.to(datumData);
        console.log("Spot Datum CBOR:", datumCbor);

        // 2. Prepare Minting Redeemer
        const redeemerData = CreateCloseOrUpdateMarketUTxOsRedeemer();
        const redeemerCbor = Data.to(redeemerData);
        console.log("Minting Redeemer CBOR:", redeemerCbor);



        // Define the minting policy using the reference script
        const beaconScriptRef = getScriptRef('BEACON');
        // const beaconMintingPolicy = {
        //     type: "PlutusV2",
        //     script: { // Reference script details
        //         type: "Reference",
        //         txHash: beaconScriptRef.txHash,
        //         outputIndex: beaconScriptRef.outputIndex
        //     }
        // };
        const beaconScriptHash = getScriptHash('BEACON');

        const beaconPolicyId = beaconScriptHash;
        console.log("Beacon Minting Policy ID:", beaconPolicyId);
        // 3. Prepare Minting Policy & Assets
        //const beaconPolicyId = getCurrencySymbol('BEACON');
        const policyBeaconNameHex = genPolicyBeaconNameHex(nftPolicyId);
        const spotBeaconNameHex = fromText(BEACON_NAMES.SPOT); // Convert text name to hex

        const mintAssets = {
            [`${beaconPolicyId}${policyBeaconNameHex}`]: 1n, // Policy Beacon
            [`${beaconPolicyId}${spotBeaconNameHex}`]: 1n,   // Spot Beacon
        };
        console.log("Assets to Mint:", mintAssets);

        // 4. Prepare Output Assets
        const outputAssets: { [key: string]: bigint } = {
            lovelace: BigInt(deposit),
            ...mintAssets // Add the freshly minted assets
        };

        // Add the NFTs being sold
        nfts.forEach(nft => {
            console.log("Adding NFT to output:", nft.assetName, nft.assetNameHex);
            const unit = `${nft.policyId}${nft.assetNameHex}`;
            outputAssets[unit] = 1n; // Assuming quantity 1 for each NFT
        });
        console.log("Assets for Output UTxO:", outputAssets);

        // 5. Determine Seller Script Address
        const sellerContractAddress = genSellerAddress(lucid, sellerRewardAddress);
        console.log("Seller Contract Address:", sellerContractAddress);

        const utxos = await wallet.getUtxos();
        if (!utxos || utxos.length === 0) {
            throw new Error("No UTxOs available in the wallet to fund the transaction.");
        }
        console.log("Available UTxOs:", utxos);

        const refUtxos = await lucid.utxosByOutRef([
            { txHash: beaconScriptRef.txHash, outputIndex: beaconScriptRef.outputIndex },
          ]);
      
          if (refUtxos.length === 0) {
            throw new Error(
              `Reference Script UTXO not found`
            );
          }
          const referenceScriptUtxo = refUtxos[0];

        // 6. Build the Transaction
        console.log("Building transaction...");
        const txBuilder = await lucid.newTx()
            // Mint the beacon tokens
            .readFrom([referenceScriptUtxo])
            .mintAssets(mintAssets, redeemerCbor)
            // Provide the script reference for the minting policy
            //.attach.MintingPolicy(beaconScriptHash)
            // Create the output UTxO at the contract address
            //.pay.ToAddressWithData(sellerContractAddress, { inline: datumCbor }, outputAssets)
            .pay.ToAddressWithData(sellerContractAddress || "", { kind: "inline", value: datumCbor }, outputAssets);
            

        //console.log("Transaction built (unsigned):", tx); // Or inspect tx object
        const completedBeforeSingTx = await txBuilder.complete();
        console.log("Transaction completed (unsigned):", completedBeforeSingTx); // Inspect the completed transaction

        // 7. Sign and Submit
        console.log("Signing transaction...");
        const toTx = completedBeforeSingTx.toTransaction();
        const signedTx = await lucid.wallet().signTx(toTx);
        console.log("Transaction signed:", signedTx); // Get Tx ID before submission

        console.log("Submitting transaction...");
        //const txHash = await lucid.wallet().submitTx(toTx);
        //console.log(`Transaction submitted successfully! TxHash: ${txHash}`);
        //console.log(`Waiting for confirmation...`);

        // Optional: Wait for confirmation
        // Optional: Wait for confirmation using a custom implementation or remove if not required
        //console.log(`Waiting for confirmation of transaction ${txHash}...`);
        //await lucid.awaitTx(txHash); // Ensure `lucid` has an `awaitTx` method or implement your own logic
        //console.log(`Transaction ${txHash} confirmed!`);

        console.log("--- Finished createSpotSaleLucid ---");
        //return txHash;
        return 'Transaction submitted successfully!';

    } catch (error) {
        console.error("Error creating Spot Sale with Lucid:");
        if (error instanceof Error) {
            console.error('Message:', error.message);
            console.error('Details:', error);
            console.error('Stack:', error.stack);
        } else {
            console.error(error);
        }
        throw error; // Re-throw the error for upstream handling
    }
}

/**
 * Get the currency symbol (policy ID) for a specific type.
 * @param {string} symbolType - e.g., 'BEACON'.
 * @returns {string} - The policy ID (hex).
 */
function getCurrencySymbol(symbolType: keyof typeof CURRENCY_SYMBOLS): string {
    if (!CURRENCY_SYMBOLS[symbolType]) {
        throw new Error(`Currency symbol for ${symbolType} is not initialized.`);
    }
    return CURRENCY_SYMBOLS[symbolType];
}

/**
 * Get the script hash for a specific script type.
 * @param {string} scriptType - 'PROXY', 'AFTERMARKET', etc.
 * @returns {string} - The script hash (hex).
 */
function getScriptHash(scriptType: keyof typeof SCRIPT_HASHES): string {
    if (!SCRIPT_HASHES[scriptType]) {
        throw new Error(`Script hash for ${scriptType} is not initialized.`);
    }
    return SCRIPT_HASHES[scriptType];
}
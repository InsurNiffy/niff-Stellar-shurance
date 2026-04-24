# Wallet Security and Persistence

## Storing Public Keys vs Private Keys
In the interest of user experience, our application persists the wallet session using `localStorage` to attempt silent auto-reconnects on page reloads.

**Important Security Implications:**
1. **Never Store Secrets:** We only persist the `walletType` and the `publicKey` (Stellar Address) in localStorage. 
2. **Never** store seed phrases, private keys, or signed transactions in local storage or sessionStorage, as these are vulnerable to XSS (Cross-Site Scripting) attacks.
3. **Public Nature of Addresses:** A public key is not secret. Storing it in localStorage merely indicates which account the user was last trying to connect with.
4. **Validation on Reconnect:** During silent reconnect (`app mount`), the app queries the wallet extension or kit for the active address. We explicitly validate that the returned address matches the persisted public key. If there is a mismatch (e.g., the user switched accounts in their wallet extension), the session is cleared to prevent impersonation bugs.

By enforcing these constraints, we ensure a smooth UX without compromising the user's private keys or allowing incorrect application states.

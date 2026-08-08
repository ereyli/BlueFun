#![no_std]

use core::convert::TryInto;
use pinocchio::{
    address::declare_id,
    cpi::{Seed, Signer},
    error::ProgramError,
    no_allocator, nostd_panic_handler, program_entrypoint,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::{CreateAccount, Transfer};

declare_id!("CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5");
program_entrypoint!(process_instruction);
no_allocator!();
nostd_panic_handler!();

const CONFIG_SEED: &[u8] = b"config";
const LAUNCH_SEED: &[u8] = b"launch";
const CONFIG_LEN: usize = 320;
const LAUNCH_LEN: usize = 472;
const UPDATE_DELAY_SECONDS: i64 = 48 * 60 * 60;
const DEFAULT_LAUNCH_FEE: u64 = 50_000_000;
const MAX_LAUNCH_FEE: u64 = 1_000_000_000;
const TOKEN_SUPPLY: u64 = 1_000_000_000_000_000_000;
const MAX_INITIAL_BUY: u64 = TOKEN_SUPPLY / 20;
const TOKEN_DECIMALS: u8 = 9;

const IX_INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
const IX_RESERVE: [u8; 8] = [60, 214, 0, 184, 198, 221, 230, 168];
const IX_FINALIZE: [u8; 8] = [113, 133, 62, 196, 58, 212, 118, 166];
const IX_MANAGE: [u8; 8] = [168, 141, 131, 54, 79, 150, 88, 36];
const IX_PAUSE: [u8; 8] = [91, 60, 125, 192, 176, 225, 166, 218];
const IX_ACCEPT_ADMIN: [u8; 8] = [112, 42, 45, 90, 116, 181, 13, 170];
const CONFIG_DISC: [u8; 8] = [155, 12, 170, 224, 30, 250, 204, 130];
const LAUNCH_DISC: [u8; 8] = [144, 51, 51, 163, 206, 85, 213, 38];
const POOL_DISC: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];
const POSITION_DISC: [u8; 8] = [170, 188, 143, 228, 122, 64, 247, 208];
const SPL_TOKEN: Address = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022: Address = Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const METEORA: Address = Address::from_str_const("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const WSOL: Address = Address::from_str_const("So11111111111111111111111111111111111111112");
const EXPECTED_FEE: [u8; 32] = [
    128, 150, 152, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

// Keep custom codes aligned with the published Anchor-compatible IDL so
// wallets and the web app can continue to show meaningful errors.
const E_INVALID: u32 = 6029;
const E_PAUSED: u32 = 6000;
const E_UNAUTHORIZED: u32 = 6026;
const E_ALREADY_FINALIZED: u32 = 6022;
const E_TIMELOCK: u32 = 6025;
const E_NO_PENDING: u32 = 6024;

fn process_instruction(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if data.len() < 8 { return Err(ProgramError::InvalidInstructionData); }
    let disc: [u8; 8] = data[..8].try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    let args = &data[8..];
    match disc {
        IX_INITIALIZE => initialize(program_id, accounts, args),
        IX_RESERVE => reserve(program_id, accounts, args),
        IX_FINALIZE => finalize(program_id, accounts),
        IX_MANAGE => manage(program_id, accounts, args),
        IX_PAUSE => set_paused(program_id, accounts, args),
        IX_ACCEPT_ADMIN => accept_admin(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize(program_id: &Address, accounts: &[AccountView], args: &[u8]) -> ProgramResult {
    let [admin, guardian, treasury, config, system] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    require_signer(admin)?;
    if !pinocchio_system::check_id(system.address()) || config.lamports() != 0 || args.len() != 32 {
        return invalid();
    }
    let initial = read_u128(args, 0)?;
    let maximum = read_u128(args, 16)?;
    if initial == 0 || maximum <= initial { return invalid(); }
    let (expected, bump) = Address::find_program_address(&[CONFIG_SEED], program_id);
    if config.address() != &expected { return invalid(); }
    let bump_bytes = [bump];
    let seeds = [Seed::from(CONFIG_SEED), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];
    let rent = Rent::get()?.try_minimum_balance(CONFIG_LEN)?;
    CreateAccount { from: admin, to: config, lamports: rent, space: CONFIG_LEN as u64, owner: program_id }
        .invoke_signed(&signers)?;
    let mut out = config.try_borrow_mut()?;
    out.fill(0);
    out[..8].copy_from_slice(&CONFIG_DISC);
    put_address(&mut out, 8, admin.address());
    put_address(&mut out, 72, guardian.address());
    put_address(&mut out, 104, treasury.address());
    put_u64(&mut out, 176, DEFAULT_LAUNCH_FEE);
    out[200..232].copy_from_slice(&EXPECTED_FEE);
    put_u16(&mut out, 232, 100);
    put_u16(&mut out, 234, 7_000);
    put_u16(&mut out, 236, 3_000);
    put_u128(&mut out, 238, initial);
    put_u128(&mut out, 254, maximum);
    out[319] = bump;
    Ok(())
}

fn reserve(program_id: &Address, accounts: &[AccountView], args: &[u8]) -> ProgramResult {
    let [creator, config, mint, launch, system] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    require_signer(creator)?;
    if !pinocchio_system::check_id(system.address()) || launch.lamports() != 0 { return invalid(); }
    verify_config(program_id, config)?;
    let (name, symbol, uri, initial_buy) = parse_reserve_args(args)?;
    if name.is_empty() || name.len() > 40 || symbol.is_empty() || symbol.len() > 10 || uri.is_empty() || uri.len() > 200 {
        return invalid();
    }
    let (expected, bump) = Address::find_program_address(&[LAUNCH_SEED, mint.address().as_ref()], program_id);
    if launch.address() != &expected { return invalid(); }
    let launch_id;
    {
        let mut cfg = config.try_borrow_mut()?;
        if cfg[310] != 0 { return custom(E_PAUSED); }
        launch_id = read_u64(&cfg, 311)?.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
        put_u64(&mut cfg, 311, launch_id);
    }
    let bump_bytes = [bump];
    let seeds = [Seed::from(LAUNCH_SEED), Seed::from(mint.address().as_ref()), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];
    let rent = Rent::get()?.try_minimum_balance(LAUNCH_LEN)?;
    CreateAccount { from: creator, to: launch, lamports: rent, space: LAUNCH_LEN as u64, owner: program_id }
        .invoke_signed(&signers)?;
    let mut out = launch.try_borrow_mut()?;
    out.fill(0);
    out[..8].copy_from_slice(&LAUNCH_DISC);
    put_u64(&mut out, 8, launch_id);
    put_address(&mut out, 16, creator.address());
    put_address(&mut out, 48, mint.address());
    let mut cursor = 176;
    write_string(&mut out, &mut cursor, name)?;
    write_string(&mut out, &mut cursor, symbol)?;
    write_string(&mut out, &mut cursor, uri)?;
    put_u64(&mut out, cursor, initial_buy); cursor += 8;
    put_i64(&mut out, cursor + 8, Clock::get()?.unix_timestamp);
    out[cursor + 25] = bump;
    Ok(())
}

fn finalize(program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [creator, config, treasury, launch, mint, pool, creator_pos, platform_pos,
        creator_nft, platform_nft, pool_vault, creator_token, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(creator)?;
    if !pinocchio_system::check_id(system.address()) { return invalid(); }
    verify_config(program_id, config)?;
    verify_launch(program_id, launch, mint)?;
    let (launch_creator, finalized, offsets) = {
        let l = launch.try_borrow()?;
        let offsets = launch_offsets(&l)?;
        (read_address(&l, 16)?, l[offsets.finalized] != 0, offsets)
    };
    if &launch_creator != creator.address() { return custom(E_UNAUTHORIZED); }
    if finalized { return custom(E_ALREADY_FINALIZED); }
    let (treasury_key, fee, initial_price, max_price, expected_fee, platform_share) = {
        let cfg = config.try_borrow()?;
        if cfg[310] != 0 { return custom(E_PAUSED); }
        (read_address(&cfg, 104)?, read_u64(&cfg, 176)?, read_u128(&cfg, 238)?,
         read_u128(&cfg, 254)?, read_array::<32>(&cfg, 200)?, read_u16(&cfg, 234)?)
    };
    if treasury.address() != &treasury_key { return invalid(); }
    verify_mint(mint)?;
    let (locked, vault_key) = verify_pool(pool, mint.address(), creator.address(), &expected_fee, initial_price, max_price)?;
    if pool_vault.address() != &vault_key { return invalid(); }
    let vault = parse_token(pool_vault)?;
    if &vault.mint != mint.address() || vault.amount > TOKEN_SUPPLY { return invalid(); }
    if TOKEN_SUPPLY - vault.amount > MAX_INITIAL_BUY { return invalid(); }
    let cpos = parse_position(creator_pos, pool.address())?;
    let ppos = parse_position(platform_pos, pool.address())?;
    let cnft = parse_token(creator_nft)?;
    let pnft = parse_token(platform_nft)?;
    if cpos.nft != cnft.mint || ppos.nft != pnft.mint || cnft.owner != launch_creator || pnft.owner != treasury_key
        || cnft.amount != 1 || pnft.amount != 1 { return invalid(); }
    let total = cpos.locked.checked_add(ppos.locked).ok_or(ProgramError::ArithmeticOverflow)?;
    if total == 0 || total != locked { return invalid(); }
    let expected_platform = total.checked_mul(platform_share as u128).ok_or(ProgramError::ArithmeticOverflow)? / 10_000;
    if ppos.locked != expected_platform || cpos.locked != total - expected_platform { return invalid(); }
    let creator_balance = parse_token(creator_token)?;
    if creator_balance.owner != launch_creator || &creator_balance.mint != mint.address() || creator_balance.amount > MAX_INITIAL_BUY {
        return invalid();
    }
    Transfer { from: creator, to: treasury, lamports: fee }.invoke()?;
    let mut l = launch.try_borrow_mut()?;
    put_address(&mut l, 80, pool.address());
    put_address(&mut l, 112, creator_pos.address());
    put_address(&mut l, 144, platform_pos.address());
    put_u64(&mut l, offsets.creator_balance, creator_balance.amount);
    put_i64(&mut l, offsets.finalized_at, Clock::get()?.unix_timestamp);
    l[offsets.finalized] = 1;
    Ok(())
}

fn manage(program_id: &Address, accounts: &[AccountView], args: &[u8]) -> ProgramResult {
    let [admin, config] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    require_signer(admin)?;
    verify_config(program_id, config)?;
    if args.len() != 49 { return Err(ProgramError::InvalidInstructionData); }
    let mut cfg = config.try_borrow_mut()?;
    if &read_address(&cfg, 8)? != admin.address() { return custom(E_UNAUTHORIZED); }
    let action = args[0];
    let value = &args[1..33];
    let secondary = &args[33..49];
    let now = Clock::get()?.unix_timestamp;
    let eta = now.checked_add(UPDATE_DELAY_SECONDS).ok_or(ProgramError::ArithmeticOverflow)?;
    match action {
        0 => { let fee = read_u64(value, 0)?; if fee > MAX_LAUNCH_FEE { return invalid(); } put_u64(&mut cfg, 184, fee); put_i64(&mut cfg, 192, eta); }
        1 => { require_eta(&cfg, 192, now)?; let value = read_u64(&cfg, 184)?; put_u64(&mut cfg, 176, value); put_u64(&mut cfg, 184, 0); put_i64(&mut cfg, 192, 0); }
        2 => { put_u64(&mut cfg, 184, 0); put_i64(&mut cfg, 192, 0); }
        3 => { if value.iter().all(|v| *v == 0) { return invalid(); } cfg[136..168].copy_from_slice(value); put_i64(&mut cfg, 168, eta); }
        4 => { require_eta(&cfg, 168, now)?; let value = read_array::<32>(&cfg, 136)?; cfg[104..136].copy_from_slice(&value); cfg[136..168].fill(0); put_i64(&mut cfg, 168, 0); }
        5 => { cfg[136..168].fill(0); put_i64(&mut cfg, 168, 0); }
        6 => { let initial = read_u128(value, 0)?; let maximum = read_u128(secondary, 0)?; if initial == 0 || maximum <= initial { return invalid(); } put_u128(&mut cfg, 270, initial); put_u128(&mut cfg, 286, maximum); put_i64(&mut cfg, 302, eta); }
        7 => { require_eta(&cfg, 302, now)?; let initial = read_u128(&cfg, 270)?; let maximum = read_u128(&cfg, 286)?; put_u128(&mut cfg, 238, initial); put_u128(&mut cfg, 254, maximum); put_u128(&mut cfg, 270, 0); put_u128(&mut cfg, 286, 0); put_i64(&mut cfg, 302, 0); }
        8 => { if value.iter().all(|v| *v == 0) { return invalid(); } cfg[40..72].copy_from_slice(value); }
        _ => return invalid(),
    }
    Ok(())
}

fn set_paused(program_id: &Address, accounts: &[AccountView], args: &[u8]) -> ProgramResult {
    let [authority, config] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    require_signer(authority)?;
    verify_config(program_id, config)?;
    if args.len() != 1 || args[0] > 1 { return invalid(); }
    let mut cfg = config.try_borrow_mut()?;
    let admin = read_address(&cfg, 8)?;
    let guardian = read_address(&cfg, 72)?;
    if authority.address() != &admin && authority.address() != &guardian { return custom(E_UNAUTHORIZED); }
    if args[0] == 0 && authority.address() != &admin { return custom(E_UNAUTHORIZED); }
    cfg[310] = args[0];
    Ok(())
}

fn accept_admin(program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [pending, config] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    require_signer(pending)?;
    verify_config(program_id, config)?;
    let mut cfg = config.try_borrow_mut()?;
    if &read_address(&cfg, 40)? != pending.address() { return custom(E_UNAUTHORIZED); }
    put_address(&mut cfg, 8, pending.address());
    cfg[40..72].fill(0);
    Ok(())
}

fn verify_config(program_id: &Address, account: &AccountView) -> ProgramResult {
    let (expected, _) = Address::find_program_address(&[CONFIG_SEED], program_id);
    if account.address() != &expected || owner(account) != program_id { return invalid(); }
    let data = account.try_borrow()?;
    if data.len() != CONFIG_LEN || data[..8] != CONFIG_DISC { return invalid(); }
    Ok(())
}

fn verify_launch(program_id: &Address, launch: &AccountView, mint: &AccountView) -> ProgramResult {
    let (expected, _) = Address::find_program_address(&[LAUNCH_SEED, mint.address().as_ref()], program_id);
    if launch.address() != &expected || owner(launch) != program_id { return invalid(); }
    let data = launch.try_borrow()?;
    if data.len() != LAUNCH_LEN || data[..8] != LAUNCH_DISC || &read_address(&data, 48)? != mint.address() { return invalid(); }
    Ok(())
}

fn verify_mint(account: &AccountView) -> ProgramResult {
    if owner(account) != &SPL_TOKEN { return invalid(); }
    let data = account.try_borrow()?;
    if data.len() < 82 || data[45] != 1 || data[44] != TOKEN_DECIMALS || read_u64(&data, 36)? != TOKEN_SUPPLY
        || read_u32(&data, 0)? != 0 || read_u32(&data, 46)? != 0 { return invalid(); }
    Ok(())
}

struct TokenState { mint: Address, owner: Address, amount: u64 }
fn parse_token(account: &AccountView) -> Result<TokenState, ProgramError> {
    if owner(account) != &SPL_TOKEN && owner(account) != &TOKEN_2022 { return Err(ProgramError::InvalidAccountOwner); }
    let data = account.try_borrow()?;
    if data.len() < 165 || data[108] != 1 { return Err(ProgramError::InvalidAccountData); }
    Ok(TokenState { mint: read_address(&data, 0)?, owner: read_address(&data, 32)?, amount: read_u64(&data, 64)? })
}

struct PositionState { nft: Address, locked: u128 }
fn parse_position(account: &AccountView, pool: &Address) -> Result<PositionState, ProgramError> {
    if owner(account) != &METEORA { return Err(ProgramError::InvalidAccountOwner); }
    let data = account.try_borrow()?;
    if data.len() < 408 || data[..8] != POSITION_DISC || &read_address(&data, 8)? != pool
        || read_u128(&data, 152)? != 0 || read_u128(&data, 168)? != 0 { return Err(ProgramError::InvalidAccountData); }
    let locked = read_u128(&data, 184)?;
    if locked == 0 { return Err(ProgramError::InvalidAccountData); }
    Ok(PositionState { nft: read_address(&data, 40)?, locked })
}

fn verify_pool(account: &AccountView, mint: &Address, creator: &Address, expected_fee: &[u8; 32], initial: u128, maximum: u128)
    -> Result<(u128, Address), ProgramError> {
    if owner(account) != &METEORA { return Err(ProgramError::InvalidAccountOwner); }
    let data = account.try_borrow()?;
    if data.len() < 1112 || data[..8] != POOL_DISC || &read_address(&data, 648)? != creator
        || &read_address(&data, 168)? != mint || read_address(&data, 200)? != WSOL
        || data[484] != 1 || data[481] != 0 || data[56] != 0 || &read_array::<32>(&data, 8)? != expected_fee {
        return Err(ProgramError::InvalidAccountData);
    }
    let configured = read_u128(&data, 152)?;
    let min = read_u128(&data, 424)?;
    let max = read_u128(&data, 440)?;
    let current = read_u128(&data, 456)?;
    if configured != initial || min != initial || max != maximum || current < initial || current > maximum {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok((read_u128(&data, 552)?, read_address(&data, 232)?))
}

struct LaunchOffsets { creator_balance: usize, finalized_at: usize, finalized: usize }
fn launch_offsets(data: &[u8]) -> Result<LaunchOffsets, ProgramError> {
    let mut cursor = 176;
    for _ in 0..3 {
        let len = read_u32(data, cursor)? as usize;
        cursor = cursor.checked_add(4 + len).ok_or(ProgramError::ArithmeticOverflow)?;
        if cursor > data.len() { return Err(ProgramError::InvalidAccountData); }
    }
    let creator_balance = cursor + 8;
    let finalized_at = cursor + 24;
    let finalized = cursor + 32;
    if finalized + 2 > data.len() { return Err(ProgramError::InvalidAccountData); }
    Ok(LaunchOffsets { creator_balance, finalized_at, finalized })
}

fn parse_reserve_args(data: &[u8]) -> Result<(&[u8], &[u8], &[u8], u64), ProgramError> {
    let mut cursor = 0;
    let name = read_string(data, &mut cursor)?;
    let symbol = read_string(data, &mut cursor)?;
    let uri = read_string(data, &mut cursor)?;
    if cursor + 8 != data.len() { return Err(ProgramError::InvalidInstructionData); }
    Ok((name, symbol, uri, read_u64(data, cursor)?))
}

fn read_string<'a>(data: &'a [u8], cursor: &mut usize) -> Result<&'a [u8], ProgramError> {
    let len = read_u32(data, *cursor)? as usize;
    *cursor = cursor.checked_add(4).ok_or(ProgramError::ArithmeticOverflow)?;
    let end = cursor.checked_add(len).ok_or(ProgramError::ArithmeticOverflow)?;
    let value = data.get(*cursor..end).ok_or(ProgramError::InvalidInstructionData)?;
    *cursor = end;
    Ok(value)
}

fn write_string(out: &mut [u8], cursor: &mut usize, value: &[u8]) -> ProgramResult {
    let end = cursor.checked_add(4 + value.len()).ok_or(ProgramError::ArithmeticOverflow)?;
    if end > out.len() { return invalid(); }
    put_u32(out, *cursor, value.len() as u32);
    out[*cursor + 4..end].copy_from_slice(value);
    *cursor = end;
    Ok(())
}

fn require_eta(data: &[u8], offset: usize, now: i64) -> ProgramResult {
    let eta = read_i64(data, offset)?;
    if eta == 0 { return custom(E_NO_PENDING); }
    if now < eta { return custom(E_TIMELOCK); }
    Ok(())
}

fn require_signer(account: &AccountView) -> ProgramResult {
    if !account.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    Ok(())
}
fn owner(account: &AccountView) -> &Address {
    // SAFETY: The runtime-owned account header remains valid for the full instruction.
    unsafe { account.owner() }
}
fn invalid<T>() -> Result<T, ProgramError> { Err(ProgramError::Custom(E_INVALID)) }
fn custom<T>(code: u32) -> Result<T, ProgramError> { Err(ProgramError::Custom(code)) }

fn read_array<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N], ProgramError> {
    data.get(offset..offset + N).and_then(|v| v.try_into().ok()).ok_or(ProgramError::InvalidAccountData)
}
fn read_address(data: &[u8], offset: usize) -> Result<Address, ProgramError> { Ok(Address::new_from_array(read_array(data, offset)?)) }
fn read_u16(data: &[u8], offset: usize) -> Result<u16, ProgramError> { Ok(u16::from_le_bytes(read_array(data, offset)?)) }
fn read_u32(data: &[u8], offset: usize) -> Result<u32, ProgramError> { Ok(u32::from_le_bytes(read_array(data, offset)?)) }
fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> { Ok(u64::from_le_bytes(read_array(data, offset)?)) }
fn read_i64(data: &[u8], offset: usize) -> Result<i64, ProgramError> { Ok(i64::from_le_bytes(read_array(data, offset)?)) }
fn read_u128(data: &[u8], offset: usize) -> Result<u128, ProgramError> { Ok(u128::from_le_bytes(read_array(data, offset)?)) }
fn put_address(data: &mut [u8], offset: usize, value: &Address) { data[offset..offset + 32].copy_from_slice(value.as_ref()); }
fn put_u16(data: &mut [u8], offset: usize, value: u16) { data[offset..offset + 2].copy_from_slice(&value.to_le_bytes()); }
fn put_u32(data: &mut [u8], offset: usize, value: u32) { data[offset..offset + 4].copy_from_slice(&value.to_le_bytes()); }
fn put_u64(data: &mut [u8], offset: usize, value: u64) { data[offset..offset + 8].copy_from_slice(&value.to_le_bytes()); }
fn put_i64(data: &mut [u8], offset: usize, value: i64) { data[offset..offset + 8].copy_from_slice(&value.to_le_bytes()); }
fn put_u128(data: &mut [u8], offset: usize, value: u128) { data[offset..offset + 16].copy_from_slice(&value.to_le_bytes()); }

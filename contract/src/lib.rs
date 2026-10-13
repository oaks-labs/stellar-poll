#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
    Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PollError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidOptionCount = 3,
    QuestionTooShort = 4,
    QuestionTooLong = 5,
    OptionTooShort = 6,
    OptionTooLong = 7,
    PollNotFound = 8,
    PollClosed = 9,
    PollNotStarted = 10,
    InvalidOptionIndex = 11,
    AlreadyVoted = 12,
    NotAuthorized = 13,
    PollAlreadyClosed = 14,
    InvalidTimeRange = 15,
    AllowlistTooLarge = 16,
    NotAllowedToVote = 17,
    PollDurationTooLong = 18,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[contracttype]
#[repr(u32)]
pub enum PollStatus {
    Scheduled = 0,
    Open = 1,
    Closed = 2,
}

const NEXT_ID_KEY: Symbol = symbol_short!("NEXT_ID");
const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const POLL_SYM: Symbol = symbol_short!("POLL");
const VOTED_SYM: Symbol = symbol_short!("VOTED");

// Storage TTL parameters (measured in ledger sequences, NOT wall-clock timestamps).
// Note: Ledger closing speed varies with network consensus (~5-6s average on Stellar,
// not a fixed constant). Persistent entries that reach TTL 0 are archived by the
// Soroban host (never silently deleted as missing entries) and require a
// RestoreFootprint operation before any transaction can access them again.
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = 50_000;
pub const INSTANCE_BUMP_AMOUNT: u32 = 100_000;
pub const STORAGE_LIFETIME_THRESHOLD: u32 = 50_000;
pub const STORAGE_BUMP_AMOUNT: u32 = 100_000;

// Maximum and default poll durations (measured in Unix timestamp seconds).
pub const MAX_POLL_DURATION_SECS: u64 = 30 * 24 * 3600; // 30 days in seconds
pub const DEFAULT_POLL_DURATION_SECS: u64 = 7 * 24 * 3600; // 7 days in seconds

// Input boundary limits
const MIN_QUESTION_LEN: u32 = 3;
const MAX_QUESTION_LEN: u32 = 280;
const MIN_OPTION_LEN: u32 = 1;
const MAX_OPTION_LEN: u32 = 100;
const MIN_OPTIONS_COUNT: u32 = 2;
const MAX_OPTIONS_COUNT: u32 = 10;
const MAX_ALLOWLIST_SIZE: u32 = 50;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Poll {
    pub id: u32,
    pub question: String,
    pub options: Vec<String>,
    pub votes: Vec<u32>,
    pub creator: Address,
    pub total_votes: u32,
    pub active: bool,
    pub start_time: u64,
    pub end_time: u64,
    pub allowlist: Vec<Address>,
}

#[contract]
pub struct LivePoll;

impl LivePoll {
    pub fn compute_status(now: u64, active: bool, start_time: u64, end_time: u64) -> PollStatus {
        if !active {
            return PollStatus::Closed;
        }
        if start_time > 0 && now < start_time {
            return PollStatus::Scheduled;
        }
        if end_time > 0 && now > end_time {
            return PollStatus::Closed;
        }
        PollStatus::Open
    }

    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    }
}

#[contractimpl]
impl LivePoll {
    /// Initialize the contract with an optional admin.
    pub fn initialize(env: Env, admin: Option<Address>) -> Result<(), PollError> {
        if env.storage().instance().has(&NEXT_ID_KEY) {
            return Err(PollError::AlreadyInitialized);
        }

        if let Some(ref a) = admin {
            a.require_auth();
            env.storage().instance().set(&ADMIN_KEY, a);
        }

        env.storage().instance().set(&NEXT_ID_KEY, &0u32);
        Self::extend_instance_ttl(&env);
        Ok(())
    }

    /// Backward-compatible poll creation (public, immediate start, no deadline).
    pub fn create_poll(
        env: Env,
        creator: Address,
        question: String,
        options: Vec<String>,
    ) -> Result<u32, PollError> {
        let empty_allowlist = Vec::new(&env);
        Self::create_poll_advanced(env, creator, question, options, 0, 0, empty_allowlist)
    }

    /// Feature-complete poll creation with timestamps and optional voter allowlist.
    pub fn create_poll_advanced(
        env: Env,
        creator: Address,
        question: String,
        options: Vec<String>,
        start_time: u64,
        end_time: u64,
        allowlist: Vec<Address>,
    ) -> Result<u32, PollError> {
        creator.require_auth();
        Self::extend_instance_ttl(&env);

        // Validate question boundaries
        let q_len = question.len();
        if q_len < MIN_QUESTION_LEN {
            return Err(PollError::QuestionTooShort);
        }
        if q_len > MAX_QUESTION_LEN {
            return Err(PollError::QuestionTooLong);
        }

        // Validate option count
        let opts_len = options.len();
        if opts_len < MIN_OPTIONS_COUNT || opts_len > MAX_OPTIONS_COUNT {
            return Err(PollError::InvalidOptionCount);
        }

        // Validate each option content and length
        let mut vote_counts = Vec::new(&env);
        for opt in options.iter() {
            let o_len = opt.len();
            if o_len < MIN_OPTION_LEN {
                return Err(PollError::OptionTooShort);
            }
            if o_len > MAX_OPTION_LEN {
                return Err(PollError::OptionTooLong);
            }
            vote_counts.push_back(0u32);
        }

        // Validate and normalize timestamps
        let now = env.ledger().timestamp();
        let effective_start = if start_time == 0 { now } else { start_time };
        let effective_end = if end_time == 0 {
            effective_start.saturating_add(DEFAULT_POLL_DURATION_SECS)
        } else {
            end_time
        };

        if effective_end <= effective_start {
            return Err(PollError::InvalidTimeRange);
        }

        if effective_end.saturating_sub(effective_start) > MAX_POLL_DURATION_SECS {
            return Err(PollError::PollDurationTooLong);
        }

        // Validate allowlist bound
        if allowlist.len() > MAX_ALLOWLIST_SIZE {
            return Err(PollError::AllowlistTooLarge);
        }

        let poll_id: u32 = env.storage().instance().get(&NEXT_ID_KEY).unwrap_or(0);

        let poll = Poll {
            id: poll_id,
            question,
            options,
            votes: vote_counts,
            creator: creator.clone(),
            total_votes: 0,
            active: true,
            start_time: effective_start,
            end_time: effective_end,
            allowlist,
        };

        // Storage TTL vs. Timestamp Deadlines:
        // Poll deadlines (`start_time`, `end_time`) are evaluated against Unix timestamps
        // (`env.ledger().timestamp()`), whereas Soroban entry TTL is measured strictly in
        // ledger sequence numbers. Because ledger close intervals vary, timestamp duration
        // cannot prove an exact ledger count. Instead, we bump `poll_key` (and `voted_key` on
        // vote) bounded by `env.storage().max_ttl()`. If a persistent entry ever reaches
        // TTL = 0, the Soroban host archives it rather than treating it as missing (`false`),
        // requiring an explicit `RestoreFootprintOp` before any contract call can access it.
        let max_ttl = env.storage().max_ttl();
        let estimated_ledgers = ((effective_end.saturating_sub(now)) / 5) as u32;
        let bump_ledgers = STORAGE_BUMP_AMOUNT
            .max(estimated_ledgers.saturating_add(10_000))
            .min(max_ttl);
        let threshold = STORAGE_LIFETIME_THRESHOLD.min(bump_ledgers);

        let poll_key = (&POLL_SYM, poll_id);
        env.storage().persistent().set(&poll_key, &poll);
        env.storage().persistent().extend_ttl(
            &poll_key,
            threshold,
            bump_ledgers,
        );
        env.storage().instance().extend_ttl(threshold, bump_ledgers);

        env.storage().instance().set(&NEXT_ID_KEY, &(poll_id + 1));

        env.events().publish((symbol_short!("CREATE"),), (poll_id, creator));

        Ok(poll_id)
    }

    /// Cast a vote on a poll.
    pub fn vote(env: Env, voter: Address, poll_id: u32, option_index: u32) -> Result<(), PollError> {
        voter.require_auth();
        Self::extend_instance_ttl(&env);

        let poll_key = (&POLL_SYM, poll_id);
        let mut poll: Poll = env
            .storage()
            .persistent()
            .get(&poll_key)
            .ok_or(PollError::PollNotFound)?;

        let now = env.ledger().timestamp();
        let status = Self::compute_status(now, poll.active, poll.start_time, poll.end_time);

        match status {
            PollStatus::Scheduled => return Err(PollError::PollNotStarted),
            PollStatus::Closed => return Err(PollError::PollClosed),
            PollStatus::Open => {}
        }

        if option_index >= poll.options.len() {
            return Err(PollError::InvalidOptionIndex);
        }

        // Enforce allowlist if configured
        if !poll.allowlist.is_empty() {
            let mut is_allowed = false;
            for allowed in poll.allowlist.iter() {
                if allowed == voter {
                    is_allowed = true;
                    break;
                }
            }
            if !is_allowed {
                return Err(PollError::NotAllowedToVote);
            }
        }

        let voted_key = (&VOTED_SYM, poll_id, voter.clone());
        if env.storage().persistent().has(&voted_key) {
            return Err(PollError::AlreadyVoted);
        }

        let current = poll.votes.get(option_index).unwrap_or(0);
        poll.votes.set(option_index, current + 1);
        poll.total_votes += 1;

        // Extend both `poll_key` and `voted_key` to the same target ledger TTL (capped by
        // `env.storage().max_ttl()`). Even if ledger sequences advance past this TTL before
        // `end_time` timestamp is reached, Soroban archives the persistent entry rather than
        // deleting it—any subsequent access fails until restored with `voted_key == true` intact.
        let max_ttl = env.storage().max_ttl();
        let estimated_ledgers = ((poll.end_time.saturating_sub(now)) / 5) as u32;
        let bump_ledgers = STORAGE_BUMP_AMOUNT
            .max(estimated_ledgers.saturating_add(10_000))
            .min(max_ttl);
        let threshold = STORAGE_LIFETIME_THRESHOLD.min(bump_ledgers);

        env.storage().persistent().set(&poll_key, &poll);
        env.storage().persistent().extend_ttl(
            &poll_key,
            threshold,
            bump_ledgers,
        );

        env.storage().persistent().set(&voted_key, &true);
        env.storage().persistent().extend_ttl(
            &voted_key,
            threshold,
            bump_ledgers,
        );
        env.storage().instance().extend_ttl(threshold, bump_ledgers);

        env.events().publish(
            (symbol_short!("VOTE"),),
            (poll_id, voter, option_index),
        );

        Ok(())
    }

    /// Close an active poll (creator only).
    pub fn close_poll(env: Env, caller: Address, poll_id: u32) -> Result<(), PollError> {
        caller.require_auth();
        Self::extend_instance_ttl(&env);

        let poll_key = (&POLL_SYM, poll_id);
        let mut poll: Poll = env
            .storage()
            .persistent()
            .get(&poll_key)
            .ok_or(PollError::PollNotFound)?;

        if poll.creator != caller {
            return Err(PollError::NotAuthorized);
        }

        if !poll.active {
            return Err(PollError::PollAlreadyClosed);
        }

        poll.active = false;
        env.storage().persistent().set(&poll_key, &poll);
        env.storage().persistent().extend_ttl(
            &poll_key,
            STORAGE_LIFETIME_THRESHOLD,
            STORAGE_BUMP_AMOUNT,
        );

        env.events().publish((symbol_short!("CLOSE"),), (poll_id,));

        Ok(())
    }

    /// Retrieve full poll data.
    pub fn get_poll(env: Env, poll_id: u32) -> Result<Poll, PollError> {
        let poll_key = (&POLL_SYM, poll_id);
        env.storage()
            .persistent()
            .get(&poll_key)
            .ok_or(PollError::PollNotFound)
    }

    /// Retrieve current poll lifecycle status dynamically based on ledger time.
    pub fn get_poll_status(env: Env, poll_id: u32) -> Result<PollStatus, PollError> {
        let poll = Self::get_poll(env.clone(), poll_id)?;
        let now = env.ledger().timestamp();
        Ok(Self::compute_status(now, poll.active, poll.start_time, poll.end_time))
    }

    /// Retrieve vote count vector.
    pub fn get_results(env: Env, poll_id: u32) -> Result<Vec<u32>, PollError> {
        let poll = Self::get_poll(env, poll_id)?;
        Ok(poll.votes)
    }

    /// Retrieve total polls created.
    pub fn get_poll_count(env: Env) -> u32 {
        Self::extend_instance_ttl(&env);
        env.storage().instance().get(&NEXT_ID_KEY).unwrap_or(0)
    }

    /// Check if a specific wallet has already voted.
    pub fn has_voted(env: Env, poll_id: u32, voter: Address) -> bool {
        let voted_key = (&VOTED_SYM, poll_id, voter);
        env.storage().persistent().has(&voted_key)
    }

    /// Paginated retrieval of polls (newest first).
    /// page: 0-indexed page number
    /// page_size: number of items per page (1 to 20)
    pub fn get_poll_page(env: Env, page: u32, page_size: u32) -> Vec<Poll> {
        Self::extend_instance_ttl(&env);
        let mut result = Vec::new(&env);
        let total = Self::get_poll_count(env.clone());

        if total == 0 || page_size == 0 {
            return result;
        }

        let clamped_size = if page_size > 20 { 20 } else { page_size };
        let offset = page.saturating_mul(clamped_size);

        if offset >= total {
            return result;
        }

        let start_index = total - 1 - offset;
        let mut current = start_index;

        for _ in 0..clamped_size {
            let poll_key = (&POLL_SYM, current);
            if let Some(poll) = env.storage().persistent().get::<_, Poll>(&poll_key) {
                result.push_back(poll);
            }
            if current == 0 {
                break;
            }
            current -= 1;
        }

        result
    }
}

#[cfg(test)]
mod test;

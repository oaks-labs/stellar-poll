#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    vec, Address, Env, IntoVal, String, Vec,
};

fn create_env() -> (Env, Address, LivePollClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LivePoll);
    let client = LivePollClient::new(&env, &contract_id);
    let creator = Address::generate(&env);
    (env, creator, client)
}

fn create_env_unmocked() -> (Env, Address, LivePollClient<'static>) {
    let env = Env::default();
    let contract_id = env.register_contract(None, LivePoll);
    let client = LivePollClient::new(&env, &contract_id);
    let creator = Address::generate(&env);
    (env, creator, client)
}

#[test]
fn test_initialize_and_double_initialize() {
    let (env, _, client) = create_env();
    let admin = Address::generate(&env);

    assert_eq!(client.initialize(&Some(admin.clone())), ());
    // Second initialization must fail
    let err = client.try_initialize(&Some(admin)).unwrap_err();
    assert_eq!(err.unwrap(), PollError::AlreadyInitialized);
}

#[test]
fn test_create_poll_success() {
    let (env, creator, client) = create_env();

    let question = String::from_str(&env, "Should we fund StellarPoll?");
    let options = vec![
        &env,
        String::from_str(&env, "Yes"),
        String::from_str(&env, "No"),
        String::from_str(&env, "Abstain"),
    ];

    let poll_id = client.create_poll(&creator, &question, &options);
    assert_eq!(poll_id, 0);
    assert_eq!(client.get_poll_count(), 1);

    let poll = client.get_poll(&0);
    assert_eq!(poll.id, 0);
    assert_eq!(poll.question, question);
    assert_eq!(poll.options.len(), 3);
    assert_eq!(poll.total_votes, 0);
    assert_eq!(poll.active, true);
    assert_eq!(poll.creator, creator);
    assert_eq!(client.get_poll_status(&0), PollStatus::Open);
}

#[test]
fn test_create_poll_boundary_validations() {
    let (env, creator, client) = create_env();

    // 1. Question too short (< 3 chars)
    let short_q = String::from_str(&env, "No");
    let opts = vec![
        &env,
        String::from_str(&env, "Opt 1"),
        String::from_str(&env, "Opt 2"),
    ];
    let err = client.try_create_poll(&creator, &short_q, &opts).unwrap_err();
    assert_eq!(err.unwrap(), PollError::QuestionTooShort);

    // 2. Options count < 2
    let valid_q = String::from_str(&env, "Valid question?");
    let one_opt = vec![&env, String::from_str(&env, "Only one")];
    let err = client.try_create_poll(&creator, &valid_q, &one_opt).unwrap_err();
    assert_eq!(err.unwrap(), PollError::InvalidOptionCount);

    // 3. Option too short
    let empty_opt = vec![
        &env,
        String::from_str(&env, "Opt 1"),
        String::from_str(&env, ""),
    ];
    let err = client.try_create_poll(&creator, &valid_q, &empty_opt).unwrap_err();
    assert_eq!(err.unwrap(), PollError::OptionTooShort);
}

#[test]
fn test_storage_lifetime_invariant_and_bounds() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, creator, client) = create_env();
    env.ledger().set_timestamp(1_000);
    env.ledger().set_sequence_number(100);

    let q = String::from_str(&env, "Duration check poll");
    let opts = vec![
        &env,
        String::from_str(&env, "Yes"),
        String::from_str(&env, "No"),
    ];
    let empty_allowlist: Vec<Address> = Vec::new(&env);

    // 1. End time before start time -> InvalidTimeRange
    let err = client
        .try_create_poll_advanced(&creator, &q, &opts, &2_000, &1_500, &empty_allowlist)
        .unwrap_err();
    assert_eq!(err.unwrap(), PollError::InvalidTimeRange);

    // 2. Poll duration exceeding MAX_POLL_DURATION_SECS (30 days = 2,592,000s) -> PollDurationTooLong
    let too_long_end = 1_000 + (31 * 24 * 3600);
    let err = client
        .try_create_poll_advanced(&creator, &q, &opts, &1_000, &too_long_end, &empty_allowlist)
        .unwrap_err();
    assert_eq!(err.unwrap(), PollError::PollDurationTooLong);

    // 3. Valid duration (14 days = 1,209,600s) succeeds
    let valid_end = 1_000 + (14 * 24 * 3600);
    let poll_id = client.create_poll_advanced(
        &creator,
        &q,
        &opts,
        &1_000,
        &valid_end,
        &empty_allowlist,
    );
    let poll = client.get_poll(&poll_id);
    assert_eq!(poll.end_time, valid_end);

    // 4. Cast a vote and inspect actual persistent storage TTL (in ledger sequences)
    let voter1 = Address::generate(&env);
    client.vote(&voter1, &poll_id, &0);

    let poll_key = (&POLL_SYM, poll_id);
    let voted_key = (&VOTED_SYM, poll_id, voter1.clone());

    let (initial_poll_ttl, initial_voted_ttl, max_ttl) = env.as_contract(&client.address, || {
        (
            env.storage().persistent().get_ttl(&poll_key),
            env.storage().persistent().get_ttl(&voted_key),
            env.storage().max_ttl(),
        )
    });

    // Both poll_key and voted_key must receive the exact same ledger-sequence TTL bump,
    // and both must be <= network max_ttl
    assert_eq!(initial_poll_ttl, initial_voted_ttl);
    assert!(initial_voted_ttl >= STORAGE_BUMP_AMOUNT);
    assert!(initial_voted_ttl <= max_ttl);

    // 5. Advance ledger sequences WITHOUT advancing timestamp (proving sequence vs timestamp independence)
    env.ledger().set_sequence_number(100 + 50_000);
    let (ttl_after_50k_ledgers_poll, ttl_after_50k_ledgers_voted) =
        env.as_contract(&client.address, || {
            (
                env.storage().persistent().get_ttl(&poll_key),
                env.storage().persistent().get_ttl(&voted_key),
            )
        });
    assert_eq!(ttl_after_50k_ledgers_poll, initial_poll_ttl - 50_000);
    assert_eq!(ttl_after_50k_ledgers_voted, initial_voted_ttl - 50_000);

    // Voter 1 still cannot double-vote after 50,000 ledgers have elapsed
    let dup_err = client.try_vote(&voter1, &poll_id, &0).unwrap_err();
    assert_eq!(dup_err.unwrap(), PollError::AlreadyVoted);

    // 6. Check clamping against lower network max_entry_ttl limit
    env.ledger().with_mut(|li| {
        li.max_entry_ttl = 120_000;
    });
    let voter2 = Address::generate(&env);
    client.vote(&voter2, &poll_id, &1);
    let voted2_key = (&VOTED_SYM, poll_id, voter2.clone());
    let clamped_ttl = env.as_contract(&client.address, || {
        env.storage().persistent().get_ttl(&voted2_key)
    });
    // max_ttl() is max_entry_ttl - 1 (live_until_ledger_seq - current_ledger)
    assert!(clamped_ttl <= 120_000);

    // 7. When an entry approaches expiration and is re-extended (restored/bumped in live state),
    // its vote marker `true` remains intact and continues to block duplicate voting.
    env.ledger().set_sequence_number(100 + 50_000 + 90_000);
    env.as_contract(&client.address, || {
        env.storage().persistent().extend_ttl(&voted2_key, 50_000, 100_000);
        env.storage().persistent().extend_ttl(&poll_key, 50_000, 100_000);
        env.storage().instance().extend_ttl(50_000, 100_000);
    });
    assert_eq!(client.has_voted(&poll_id, &voter2), true);
    let dup2_err = client.try_vote(&voter2, &poll_id, &1).unwrap_err();
    assert_eq!(dup2_err.unwrap(), PollError::AlreadyVoted);
}

#[test]
#[should_panic(expected = "Error(Storage, InternalError)")]
fn test_archived_persistent_vote_marker_aborts_rather_than_acting_missing() {
    let (env, creator, client) = create_env();
    env.ledger().set_timestamp(1_000);
    env.ledger().set_sequence_number(100);
    env.ledger().with_mut(|li| {
        li.max_entry_ttl = 110_000;
    });

    let q = String::from_str(&env, "Archival behavior verification");
    let opts = vec![
        &env,
        String::from_str(&env, "Yes"),
        String::from_str(&env, "No"),
    ];
    let empty_allowlist: Vec<Address> = Vec::new(&env);

    // Create a 14-day poll (end_time = 1_210_600)
    let valid_end = 1_000 + (14 * 24 * 3600);
    let poll_id = client.create_poll_advanced(
        &creator,
        &q,
        &opts,
        &1_000,
        &valid_end,
        &empty_allowlist,
    );

    let voter = Address::generate(&env);
    client.vote(&voter, &poll_id, &0);

    // Advance 80,000 ledgers and bump ONLY the contract instance and poll_key,
    // leaving voter's persistent `voted_key` to expire after 110,000 ledgers.
    env.ledger().set_sequence_number(100 + 80_000);
    let poll_key = (&POLL_SYM, poll_id);
    env.as_contract(&client.address, || {
        env.storage().instance().extend_ttl(100_000, 100_000);
        env.storage().persistent().extend_ttl(&poll_key, 100_000, 100_000);
    });

    // Advance to ledger 100 + 130,000:
    // - Timestamp is still 1_000 (< valid_end), so poll is open by timestamp.
    // - `instance` and `poll_key` are still live (TTL remaining ~50,000 ledgers).
    // - `voted_key` has exceeded its ledger TTL and is now ARCHIVED.
    env.ledger().set_sequence_number(100 + 130_000);

    // Attempting to vote again with an archived `voted_key` MUST NOT treat the archived
    // entry as missing (`has() == false`). Instead, the Soroban host aborts with a storage
    // error because archived persistent entries cannot be accessed without RestoreFootprintOp.
    client.vote(&voter, &poll_id, &0);
}

#[test]
fn test_exact_timestamp_boundaries() {
    let (env, creator, client) = create_env();
    let q = String::from_str(&env, "Exact boundary test");
    let opts = vec![
        &env,
        String::from_str(&env, "A"),
        String::from_str(&env, "B"),
    ];
    let empty_allowlist: Vec<Address> = Vec::new(&env);

    let start_time = 1_000u64;
    let end_time = 2_000u64;

    let poll_id = client.create_poll_advanced(
        &creator,
        &q,
        &opts,
        &start_time,
        &end_time,
        &empty_allowlist,
    );

    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);

    // 1. One second before opening (t = 999) -> Scheduled, vote rejected
    env.ledger().set_timestamp(999);
    assert_eq!(client.get_poll_status(&poll_id), PollStatus::Scheduled);
    let err = client.try_vote(&voter1, &poll_id, &0).unwrap_err();
    assert_eq!(err.unwrap(), PollError::PollNotStarted);

    // 2. Exact start second (t = 1000) -> Open, vote accepted
    env.ledger().set_timestamp(1_000);
    assert_eq!(client.get_poll_status(&poll_id), PollStatus::Open);
    client.vote(&voter1, &poll_id, &0);
    assert_eq!(client.has_voted(&poll_id, &voter1), true);

    // 3. Exact end second (t = 2000) -> Open, vote accepted
    env.ledger().set_timestamp(2_000);
    assert_eq!(client.get_poll_status(&poll_id), PollStatus::Open);
    client.vote(&voter2, &poll_id, &1);
    assert_eq!(client.has_voted(&poll_id, &voter2), true);

    // 4. One second after closing (t = 2001) -> Closed, vote rejected
    env.ledger().set_timestamp(2_001);
    assert_eq!(client.get_poll_status(&poll_id), PollStatus::Closed);
    let err = client.try_vote(&voter3, &poll_id, &0).unwrap_err();
    assert_eq!(err.unwrap(), PollError::PollClosed);

    // 5. Far in future (t = 5000) -> Closed, vote rejected
    env.ledger().set_timestamp(5_000);
    assert_eq!(client.get_poll_status(&poll_id), PollStatus::Closed);
    let err = client.try_vote(&voter4, &poll_id, &0).unwrap_err();
    assert_eq!(err.unwrap(), PollError::PollClosed);
}

#[test]
fn test_vote_and_results_and_double_voting() {
    let (env, creator, client) = create_env();

    let question = String::from_str(&env, "Favorite Layer 1?");
    let options = vec![
        &env,
        String::from_str(&env, "Stellar"),
        String::from_str(&env, "Other"),
    ];

    let poll_id = client.create_poll(&creator, &question, &options);

    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);

    // First votes
    client.vote(&voter1, &poll_id, &0);
    client.vote(&voter2, &poll_id, &0);

    let results = client.get_results(&poll_id);
    assert_eq!(results.get(0).unwrap(), 2);
    assert_eq!(results.get(1).unwrap(), 0);

    let poll = client.get_poll(&poll_id);
    assert_eq!(poll.total_votes, 2);

    // Duplicate vote on same option fails
    let err = client.try_vote(&voter1, &poll_id, &0).unwrap_err();
    assert_eq!(err.unwrap(), PollError::AlreadyVoted);

    // Duplicate vote on different option also fails
    let err = client.try_vote(&voter1, &poll_id, &1).unwrap_err();
    assert_eq!(err.unwrap(), PollError::AlreadyVoted);
}

#[test]
fn test_invalid_option_indices() {
    let (env, creator, client) = create_env();
    let q = String::from_str(&env, "Option bound check");
    let opts = vec![
        &env,
        String::from_str(&env, "Option 0"),
        String::from_str(&env, "Option 1"),
    ];
    let poll_id = client.create_poll(&creator, &q, &opts);
    let voter = Address::generate(&env);

    // Index 2 (out of bounds for 2 options)
    let err = client.try_vote(&voter, &poll_id, &2).unwrap_err();
    assert_eq!(err.unwrap(), PollError::InvalidOptionIndex);

    // Large index
    let err = client.try_vote(&voter, &poll_id, &999).unwrap_err();
    assert_eq!(err.unwrap(), PollError::InvalidOptionIndex);

    // u32::MAX
    let err = client.try_vote(&voter, &poll_id, &u32::MAX).unwrap_err();
    assert_eq!(err.unwrap(), PollError::InvalidOptionIndex);
}

#[test]
fn test_allowlist_enforcement() {
    let (env, creator, client) = create_env();

    let question = String::from_str(&env, "DAO Council Vote?");
    let options = vec![
        &env,
        String::from_str(&env, "Yes"),
        String::from_str(&env, "No"),
    ];

    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let non_member = Address::generate(&env);

    let allowlist = vec![&env, member1.clone(), member2.clone()];
    let poll_id = client.create_poll_advanced(&creator, &question, &options, &0, &0, &allowlist);

    // Unauthorized voter
    let err = client.try_vote(&non_member, &poll_id, &0).unwrap_err();
    assert_eq!(err.unwrap(), PollError::NotAllowedToVote);

    // Member 1 can vote
    client.vote(&member1, &poll_id, &0);
    assert_eq!(client.has_voted(&poll_id, &member1), true);
}

#[test]
fn test_close_poll_authorization_and_lifecycle() {
    let (env, creator, client) = create_env();

    let question = String::from_str(&env, "Ad-hoc feedback");
    let options = vec![
        &env,
        String::from_str(&env, "Good"),
        String::from_str(&env, "Needs Work"),
    ];
    let poll_id = client.create_poll(&creator, &question, &options);

    let non_creator = Address::generate(&env);

    // Non-creator cannot close
    let err = client.try_close_poll(&non_creator, &poll_id).unwrap_err();
    assert_eq!(err.unwrap(), PollError::NotAuthorized);

    // Creator can close
    client.close_poll(&creator, &poll_id);
    assert_eq!(client.get_poll_status(&poll_id), PollStatus::Closed);

    // Closing already closed poll fails
    let err = client.try_close_poll(&creator, &poll_id).unwrap_err();
    assert_eq!(err.unwrap(), PollError::PollAlreadyClosed);

    // Voting on closed poll fails
    let voter = Address::generate(&env);
    let err = client.try_vote(&voter, &poll_id, &0).unwrap_err();
    assert_eq!(err.unwrap(), PollError::PollClosed);
}

#[test]
fn test_negative_authorization_with_valid_poll() {
    let (env, creator, client) = create_env_unmocked();

    let question = String::from_str(&env, "Governance Proposal #1");
    let options = vec![
        &env,
        String::from_str(&env, "Approve"),
        String::from_str(&env, "Reject"),
    ];

    // Explicitly authorize creator for create_poll
    env.mock_auths(&[MockAuth {
        address: &creator,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "create_poll",
            args: (creator.clone(), question.clone(), options.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let poll_id = client.create_poll(&creator, &question, &options);
    assert_eq!(poll_id, 0);

    // Initial state check
    let poll_before = client.get_poll(&poll_id);
    assert_eq!(poll_before.total_votes, 0);
    assert_eq!(poll_before.active, true);

    let voter = Address::generate(&env);
    let mallory = Address::generate(&env);

    // 1. Unauthorized vote: voter did NOT sign / is not in mock_auths
    let vote_res = client.try_vote(&voter, &poll_id, &0);
    assert!(vote_res.is_err());
    let vote_err = vote_res.unwrap_err();
    assert!(vote_err.is_err(), "Expected host authorization error for unauthorized voter");

    // Verify UNCHANGED state after failed vote
    let poll_after_vote = client.get_poll(&poll_id);
    assert_eq!(poll_after_vote.total_votes, 0);
    assert_eq!(poll_after_vote.votes.get(0).unwrap(), 0);
    assert_eq!(client.has_voted(&poll_id, &voter), false);

    // 2. Unauthorized close by non-creator with non-creator's own signature:
    // Mallory signs as herself, but she is NOT the creator -> returns PollError::NotAuthorized
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "close_poll",
            args: (mallory.clone(), poll_id).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let close_res = client.try_close_poll(&mallory, &poll_id);
    assert!(close_res.is_err());
    let close_err = close_res.unwrap_err();
    assert_eq!(close_err.unwrap(), PollError::NotAuthorized);

    // 3. Unauthorized close pretending to be creator without creator's signature:
    // Mallory calls close_poll(&creator, &poll_id) without creator authorization
    let imposter_res = client.try_close_poll(&creator, &poll_id);
    assert!(imposter_res.is_err());
    let imposter_err = imposter_res.unwrap_err();
    assert!(imposter_err.is_err(), "Expected host authorization error for forged creator caller");

    // Verify UNCHANGED state after failed close attempts: poll remains open and active
    let poll_final = client.get_poll(&poll_id);
    assert_eq!(poll_final.active, true);
    assert_eq!(client.get_poll_status(&poll_id), PollStatus::Open);
}

#[test]
fn test_poll_pagination_and_bounds() {
    let (env, creator, client) = create_env();

    // 1. Pagination on empty contract
    let empty_page = client.get_poll_page(&0, &5);
    assert_eq!(empty_page.len(), 0);

    // 2. page_size == 0 returns empty
    let zero_size = client.get_poll_page(&0, &0);
    assert_eq!(zero_size.len(), 0);

    // Create 7 polls
    for i in 0..7 {
        let q = String::from_str(&env, "Poll question number here");
        let opts = vec![
            &env,
            String::from_str(&env, "Option A"),
            String::from_str(&env, "Option B"),
        ];
        let id = client.create_poll(&creator, &q, &opts);
        assert_eq!(id, i);
    }

    assert_eq!(client.get_poll_count(), 7);

    // Page 0 (size 3) -> newest IDs: 6, 5, 4
    let page0 = client.get_poll_page(&0, &3);
    assert_eq!(page0.len(), 3);
    assert_eq!(page0.get(0).unwrap().id, 6);
    assert_eq!(page0.get(1).unwrap().id, 5);
    assert_eq!(page0.get(2).unwrap().id, 4);

    // Page 1 (size 3) -> IDs: 3, 2, 1
    let page1 = client.get_poll_page(&1, &3);
    assert_eq!(page1.len(), 3);
    assert_eq!(page1.get(0).unwrap().id, 3);
    assert_eq!(page1.get(1).unwrap().id, 2);
    assert_eq!(page1.get(2).unwrap().id, 1);

    // Page 2 (size 3) -> remaining ID: 0
    let page2 = client.get_poll_page(&2, &3);
    assert_eq!(page2.len(), 1);
    assert_eq!(page2.get(0).unwrap().id, 0);

    // Page 3 (size 3) -> out of bounds, returns empty
    let page3 = client.get_poll_page(&3, &3);
    assert_eq!(page3.len(), 0);

    // Page size > 20 clamped to 20
    let page_large = client.get_poll_page(&0, &50);
    assert_eq!(page_large.len(), 7);
}

#[test]
fn test_events_emission() {
    let (env, creator, client) = create_env();

    let question = String::from_str(&env, "Events testing");
    let options = vec![
        &env,
        String::from_str(&env, "Yes"),
        String::from_str(&env, "No"),
    ];

    // 1. CREATE event
    let poll_id = client.create_poll(&creator, &question, &options);
    let events = env.events().all();
    assert!(events.len() > 0);

    // 2. VOTE event
    let voter = Address::generate(&env);
    client.vote(&voter, &poll_id, &0);
    let events = env.events().all();
    assert!(events.len() >= 2);

    // 3. CLOSE event
    client.close_poll(&creator, &poll_id);
    let events = env.events().all();
    assert!(events.len() >= 3);
}

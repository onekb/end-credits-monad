// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EndCredits} from "../contracts/EndCredits.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
}

contract TestToken is ERC20 {
    constructor() ERC20("Demo USDC", "dUSDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract FeeToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            super._update(from, address(0), value / 100);
            value -= value / 100;
        }
        super._update(from, to, value);
    }
}

contract ReentrantToken is ERC20 {
    EndCredits public target;
    uint256 public targetSeason;
    bool public attempted;
    constructor() ERC20("Reentrant", "REENT") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setTarget(EndCredits app, uint256 season) external { target = app; targetSeason = season; }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (!attempted && address(target) != address(0)) {
            attempted = true;
            try target.tip(targetSeason, 1) { revert("reentry succeeded"); } catch {}
        }
        return super.transferFrom(from, to, value);
    }
}

contract EndCreditsTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant CREATOR = address(0x1001);
    address constant R1 = address(0x2001);
    address constant R2 = address(0x2002);
    address constant R3 = address(0x2003);
    address constant ALICE = address(0x3001);
    address constant BOB = address(0x3002);
    address constant CAROL = address(0x3003);
    address constant TIPPER = address(0x4001);
    TestToken token;
    EndCredits app;
    uint64 submissionEnd;
    uint64 reviewEnd;
    uint64 tipEnd;

    function setUp() public {
        token = new TestToken();
        app = new EndCredits(IERC20(address(token)));
        submissionEnd = uint64(block.timestamp + 1 days);
        reviewEnd = submissionEnd + 1 days;
        tipEnd = reviewEnd + 3 days;
        token.mint(TIPPER, 1_000_000);
    }

    function config(uint16 bps) internal view returns (EndCredits.SeasonConfig memory c) {
        c = EndCredits.SeasonConfig(CREATOR, [R1, R2, R3], submissionEnd, reviewEnd, tipEnd, bps, keccak256("story"));
    }

    function create() internal returns (uint256) {
        vm.prank(CREATOR);
        return app.createSeason(config(2000));
    }

    function submit(uint256 season, address who, EndCredits.Category category) internal returns (uint256) {
        vm.prank(who);
        return app.submitContribution(season, category, keccak256(abi.encode(who, category)));
    }

    function approve(uint256 id) internal {
        vm.prank(R1); app.reviewContribution(id, true);
        vm.prank(R2); app.reviewContribution(id, true);
    }

    function testFullFlowAndRounding() public {
        uint256 season = create();
        uint256 a = submit(season, ALICE, EndCredits.Category.Guide);
        uint256 b = submit(season, BOB, EndCredits.Category.VisualOrEvent);
        uint256 c = submit(season, CAROL, EndCredits.Category.Help);
        vm.warp(submissionEnd);
        approve(a); approve(b); approve(c);
        vm.warp(reviewEnd);
        app.finalizeSeason(season);
        require(app.weightOf(season, ALICE) == 3 && app.weightOf(season, BOB) == 2 && app.weightOf(season, CAROL) == 1, "weights");
        vm.prank(TIPPER); token.approve(address(app), 101);
        vm.prank(TIPPER); app.tip(season, 100);
        vm.prank(TIPPER); app.tip(season, 1);
        require(app.getClaimableCreator(season) == 81, "creator allocation");
        require(app.getClaimableContributor(season, ALICE) == 10, "alice base");
        require(app.getClaimableContributor(season, BOB) == 6, "bob base");
        require(app.getClaimableContributor(season, CAROL) == 3, "carol base");
        app.claimCreator(season);
        app.claimContributor(season, BOB);
        vm.expectRevert(); app.claimContributor(season, BOB);
        vm.warp(tipEnd);
        app.closeSeason(season);
        app.claimContributor(season, ALICE);
        app.claimContributor(season, CAROL);
        require(token.balanceOf(CREATOR) == 81, "creator paid");
        require(token.balanceOf(ALICE) == 11 && token.balanceOf(BOB) == 6 && token.balanceOf(CAROL) == 3, "all pool paid");
        require(token.balanceOf(address(app)) == 0, "conservation");
    }

    function testGuardsAndNoEligible() public {
        uint256 season = create();
        uint256 id = submit(season, ALICE, EndCredits.Category.Help);
        vm.prank(ALICE); app.withdrawContribution(id);
        vm.warp(submissionEnd);
        vm.expectRevert(); app.reviewContribution(id, true);
        vm.expectRevert(); app.submitContribution(season, EndCredits.Category.Help, keccak256("late"));
        vm.warp(reviewEnd);
        app.finalizeSeason(season);
        vm.expectRevert(); app.tip(season, 100);
    }

    function testSelfReviewAndDuplicateVote() public {
        uint256 season = create();
        uint256 id = submit(season, R1, EndCredits.Category.Guide);
        vm.warp(submissionEnd);
        vm.prank(R1); vm.expectRevert(); app.reviewContribution(id, true);
        vm.prank(R2); app.reviewContribution(id, true);
        vm.prank(R2); vm.expectRevert(); app.reviewContribution(id, false);
        vm.prank(R3); app.reviewContribution(id, true);
        vm.warp(reviewEnd); app.finalizeSeason(season);
        require(app.weightOf(season, R1) == 3, "valid votes");
    }

    function testFeeTokenRejected() public {
        FeeToken fee = new FeeToken();
        EndCredits other = new EndCredits(IERC20(address(fee)));
        vm.prank(CREATOR); uint256 season = other.createSeason(config(2000));
        vm.prank(ALICE); uint256 id = other.submitContribution(season, EndCredits.Category.Help, keccak256("help"));
        vm.warp(submissionEnd);
        vm.prank(R1); other.reviewContribution(id, true);
        vm.prank(R2); other.reviewContribution(id, true);
        vm.warp(reviewEnd); other.finalizeSeason(season);
        fee.mint(TIPPER, 100);
        vm.prank(TIPPER); fee.approve(address(other), 100);
        vm.prank(TIPPER); vm.expectRevert(); other.tip(season, 100);
        require(fee.balanceOf(address(other)) == 0, "atomic revert");
    }

    function testCapsAndDeadlineRules() public {
        uint256 season = create();
        vm.prank(address(0x9999)); vm.expectRevert(); app.reviewContribution(1, true);
        for (uint160 i = 1; i <= 20; ++i) submit(season, address(0x5000 + i), EndCredits.Category.Help);
        vm.prank(address(0x9999)); vm.expectRevert(); app.submitContribution(season, EndCredits.Category.Help, keccak256("overflow people"));
        for (uint256 i; i < 20; ++i) submit(season, address(0x5001), EndCredits.Category.Help);
        vm.prank(address(0x5001)); vm.expectRevert(); app.submitContribution(season, EndCredits.Category.Help, keccak256("overflow submissions"));
        vm.expectRevert(); app.finalizeSeason(season);
        vm.warp(submissionEnd);
        vm.prank(R1); app.reviewContribution(1, true);
        vm.prank(R2); app.reviewContribution(1, true);
        vm.warp(reviewEnd);
        app.finalizeSeason(season);
        vm.expectRevert(); app.finalizeSeason(season);
        vm.expectRevert(); app.closeSeason(season);
        vm.warp(tipEnd);
        vm.expectRevert(); app.tip(season, 1);
        app.closeSeason(season);
    }

    function testReentrancyCannotCreditSecondTip() public {
        ReentrantToken reent = new ReentrantToken();
        EndCredits other = new EndCredits(IERC20(address(reent)));
        vm.prank(CREATOR); uint256 season = other.createSeason(config(2000));
        vm.prank(ALICE); uint256 id = other.submitContribution(season, EndCredits.Category.Help, keccak256("help"));
        vm.warp(submissionEnd);
        vm.prank(R1); other.reviewContribution(id, true);
        vm.prank(R2); other.reviewContribution(id, true);
        vm.warp(reviewEnd); other.finalizeSeason(season);
        reent.setTarget(other, season);
        reent.mint(TIPPER, 100);
        vm.prank(TIPPER); reent.approve(address(other), 100);
        vm.prank(TIPPER); other.tip(season, 100);
        EndCredits.Season memory s = other.getSeason(season);
        require(reent.attempted() && s.totalTips == 100, "reentry blocked");
    }
}

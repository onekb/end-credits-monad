// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice One immutable season rule set; votes and payouts are settled on chain.
contract EndCredits is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Active, Finalized, Closed, NoEligibleContributions }
    enum Category { Guide, VisualOrEvent, Help }

    struct SeasonConfig {
        address payoutAddress;
        address[3] reviewers;
        uint64 submissionEnd;
        uint64 reviewEnd;
        uint64 tipEnd;
        uint16 contributorBps;
        bytes32 metadataHash;
    }

    struct Season {
        address creator;
        address payoutAddress;
        address[3] reviewers;
        uint64 submissionEnd;
        uint64 reviewEnd;
        uint64 tipEnd;
        uint16 contributorBps;
        bytes32 metadataHash;
        Status status;
        uint256 totalTips;
        uint256 creatorAllocation;
        uint256 contributorAllocation;
        uint256 totalWeight;
        uint256 creatorClaimed;
        uint32 submissionCount;
        uint32 contributorCount;
    }

    struct Contribution {
        uint256 seasonId;
        address contributor;
        Category category;
        bytes32 contentHash;
        uint8 approvals;
        uint8 rejections;
        bool withdrawn;
    }

    IERC20 public immutable paymentToken;
    uint256 public seasonCount;
    uint256 public contributionCount;
    mapping(uint256 => Season) public seasons;
    mapping(uint256 => Contribution) public contributions;
    mapping(uint256 => uint256[]) private seasonContributionIds;
    mapping(uint256 => address[]) private seasonContributors;
    mapping(uint256 => mapping(address => bool)) private seenContributor;
    mapping(uint256 => mapping(address => uint256)) public weightOf;
    mapping(uint256 => mapping(address => uint256)) public contributorClaimed;
    mapping(uint256 => address) public remainderRecipient;

    event SeasonCreated(uint256 indexed seasonId, address indexed creator, address payoutAddress, bytes32 metadataHash);
    event ContributionSubmitted(uint256 indexed seasonId, uint256 indexed contributionId, address indexed contributor, Category category, bytes32 contentHash);
    event ContributionWithdrawn(uint256 indexed seasonId, uint256 indexed contributionId);
    event ContributionReviewed(uint256 indexed seasonId, uint256 indexed contributionId, address indexed reviewer, bool approved);
    event SeasonFinalized(uint256 indexed seasonId, uint256 totalWeight, uint256 eligibleContributions);
    event SeasonNoEligibleContributions(uint256 indexed seasonId);
    event TipReceived(uint256 indexed seasonId, address indexed sender, uint256 amount, uint256 creatorShare, uint256 contributorShare);
    event CreatorClaimed(uint256 indexed seasonId, address indexed payoutAddress, uint256 amount);
    event ContributorClaimed(uint256 indexed seasonId, address indexed contributor, uint256 amount);
    event SeasonClosed(uint256 indexed seasonId);

    constructor(IERC20 token) {
        require(address(token) != address(0) && address(token).code.length > 0, "invalid token");
        paymentToken = token;
    }

    function createSeason(SeasonConfig calldata c) external returns (uint256 id) {
        require(c.payoutAddress != address(0), "invalid payout");
        require(c.metadataHash != bytes32(0), "empty metadata hash");
        require(c.contributorBps >= 500 && c.contributorBps <= 3000, "bps out of range");
        require(c.submissionEnd > block.timestamp, "submission ended");
        require(c.reviewEnd > c.submissionEnd, "review order");
        require(c.tipEnd >= c.reviewEnd + 48 hours, "tip window too short");
        for (uint256 i; i < 3; ++i) {
            require(c.reviewers[i] != address(0) && c.reviewers[i] != msg.sender, "invalid reviewer");
            for (uint256 j; j < i; ++j) require(c.reviewers[i] != c.reviewers[j], "duplicate reviewer");
        }
        id = ++seasonCount;
        Season storage s = seasons[id];
        s.creator = msg.sender;
        s.payoutAddress = c.payoutAddress;
        s.reviewers = c.reviewers;
        s.submissionEnd = c.submissionEnd;
        s.reviewEnd = c.reviewEnd;
        s.tipEnd = c.tipEnd;
        s.contributorBps = c.contributorBps;
        s.metadataHash = c.metadataHash;
        emit SeasonCreated(id, msg.sender, c.payoutAddress, c.metadataHash);
    }

    function submitContribution(uint256 seasonId, Category category, bytes32 contentHash) external returns (uint256 id) {
        Season storage s = seasons[seasonId];
        require(s.creator != address(0) && s.status == Status.Active, "inactive season");
        require(block.timestamp < s.submissionEnd, "submission ended");
        require(s.submissionCount < 40, "submission cap");
        require(contentHash != bytes32(0), "empty hash");
        require(uint8(category) <= uint8(Category.Help), "invalid category");
        if (!seenContributor[seasonId][msg.sender]) {
            require(s.contributorCount < 20, "contributor cap");
            seenContributor[seasonId][msg.sender] = true;
            ++s.contributorCount;
            seasonContributors[seasonId].push(msg.sender);
        }
        ++s.submissionCount;
        id = ++contributionCount;
        contributions[id] = Contribution(seasonId, msg.sender, category, contentHash, 0, 0, false);
        seasonContributionIds[seasonId].push(id);
        emit ContributionSubmitted(seasonId, id, msg.sender, category, contentHash);
    }

    function withdrawContribution(uint256 id) external {
        Contribution storage c = contributions[id];
        Season storage s = seasons[c.seasonId];
        require(c.contributor == msg.sender && c.seasonId != 0, "not contributor");
        require(block.timestamp < s.submissionEnd, "submission ended");
        require(c.approvals == 0 && c.rejections == 0 && !c.withdrawn, "already handled");
        c.withdrawn = true;
        emit ContributionWithdrawn(c.seasonId, id);
    }

    function reviewContribution(uint256 id, bool approve) external {
        Contribution storage c = contributions[id];
        Season storage s = seasons[c.seasonId];
        require(c.seasonId != 0 && !c.withdrawn && s.status == Status.Active, "inactive contribution");
        require(block.timestamp >= s.submissionEnd && block.timestamp < s.reviewEnd, "outside review");
        require(msg.sender != c.contributor, "self review");
        uint8 bit;
        for (uint8 i; i < 3; ++i) if (s.reviewers[i] == msg.sender) bit = uint8(1 << i);
        require(bit != 0, "not reviewer");
        require(((c.approvals | c.rejections) & bit) == 0, "already voted");
        if (approve) c.approvals |= bit;
        else c.rejections |= bit;
        emit ContributionReviewed(c.seasonId, id, msg.sender, approve);
    }

    function finalizeSeason(uint256 seasonId) external {
        Season storage s = seasons[seasonId];
        require(s.creator != address(0) && s.status == Status.Active, "inactive season");
        require(block.timestamp >= s.reviewEnd, "review ongoing");
        uint256[] storage ids = seasonContributionIds[seasonId];
        uint256 eligible;
        for (uint256 i; i < ids.length; ++i) {
            Contribution storage c = contributions[ids[i]];
            if (!c.withdrawn && _popcount(c.approvals) >= 2) {
                uint256 points = c.category == Category.Guide ? 3 : c.category == Category.VisualOrEvent ? 2 : 1;
                if (weightOf[seasonId][c.contributor] == 0 && remainderRecipient[seasonId] == address(0)) {
                    remainderRecipient[seasonId] = c.contributor;
                }
                weightOf[seasonId][c.contributor] += points;
                s.totalWeight += points;
                ++eligible;
            }
        }
        if (eligible == 0) {
            s.status = Status.NoEligibleContributions;
            emit SeasonNoEligibleContributions(seasonId);
        } else {
            s.status = Status.Finalized;
            emit SeasonFinalized(seasonId, s.totalWeight, eligible);
        }
    }

    function tip(uint256 seasonId, uint256 amount) external nonReentrant {
        Season storage s = seasons[seasonId];
        require(s.status == Status.Finalized && block.timestamp < s.tipEnd, "tips closed");
        require(amount > 0, "zero tip");
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        require(paymentToken.balanceOf(address(this)) - beforeBalance == amount, "nonstandard token");
        uint256 pool = amount * s.contributorBps / 10_000;
        uint256 creatorShare = amount - pool;
        s.totalTips += amount;
        s.creatorAllocation += creatorShare;
        s.contributorAllocation += pool;
        emit TipReceived(seasonId, msg.sender, amount, creatorShare, pool);
    }

    function claimCreator(uint256 seasonId) external nonReentrant {
        Season storage s = seasons[seasonId];
        uint256 amount = getClaimableCreator(seasonId);
        require(amount > 0, "nothing to claim");
        s.creatorClaimed += amount;
        paymentToken.safeTransfer(s.payoutAddress, amount);
        emit CreatorClaimed(seasonId, s.payoutAddress, amount);
    }

    function claimContributor(uint256 seasonId, address contributor) external nonReentrant {
        uint256 amount = getClaimableContributor(seasonId, contributor);
        require(amount > 0, "nothing to claim");
        contributorClaimed[seasonId][contributor] += amount;
        paymentToken.safeTransfer(contributor, amount);
        emit ContributorClaimed(seasonId, contributor, amount);
    }

    function closeSeason(uint256 seasonId) external {
        Season storage s = seasons[seasonId];
        require(s.status == Status.Finalized && block.timestamp >= s.tipEnd, "cannot close");
        s.status = Status.Closed;
        emit SeasonClosed(seasonId);
    }

    function getClaimableCreator(uint256 seasonId) public view returns (uint256) {
        Season storage s = seasons[seasonId];
        return s.creatorAllocation - s.creatorClaimed;
    }

    function getClaimableContributor(uint256 seasonId, address contributor) public view returns (uint256) {
        Season storage s = seasons[seasonId];
        uint256 weight = weightOf[seasonId][contributor];
        if (weight == 0 || s.totalWeight == 0) return 0;
        uint256 allocation = s.contributorAllocation * weight / s.totalWeight;
        if (s.status == Status.Closed && contributor == remainderRecipient[seasonId]) {
            uint256 allocated;
            address[] storage people = seasonContributors[seasonId];
            for (uint256 i; i < people.length; ++i) {
                allocated += s.contributorAllocation * weightOf[seasonId][people[i]] / s.totalWeight;
            }
            allocation += s.contributorAllocation - allocated;
        }
        return allocation - contributorClaimed[seasonId][contributor];
    }

    function getSeason(uint256 id) external view returns (Season memory) { return seasons[id]; }
    function getContribution(uint256 id) external view returns (Contribution memory) { return contributions[id]; }
    function getSeasonContributionIds(uint256 id) external view returns (uint256[] memory) { return seasonContributionIds[id]; }
    function getSeasonContributors(uint256 id) external view returns (address[] memory) { return seasonContributors[id]; }

    function _popcount(uint8 value) private pure returns (uint8 count) {
        while (value != 0) { count += value & 1; value >>= 1; }
    }
}

import { AppError } from "../errors.js";
import { type Actor, assertManagesMembers, visibleGroup } from "../groups/groups.service.js";
import { todayInLagos } from "../groups/groups.validation.js";
import { withOrg } from "../tenancy.js";
import { allocate } from "./allocation.js";
import * as paymentModel from "./payments.model.js";

type CashInput = { amount: number; note: string | null };

/**
 * Records cash a member handed to an officer and splits it across that person's cycles in the
 * organisation. The payment, its contributions, and any credit are written in one transaction.
 */
export async function logCash(actor: Actor, groupId: string, memberId: string, input: CashInput) {
  const { organisationId, userId } = actor;
  return withOrg(organisationId, userId, async (tx) => {
    await visibleGroup(actor, groupId, tx);
    assertManagesMembers(actor);
    const member = await paymentModel.findMember(groupId, memberId, tx);
    if (!member) throw new AppError(404, "member_not_found", "Member not found");

    await paymentModel.lockPerson(organisationId, member.phoneNumber, tx);
    const candidates = await paymentModel.findCandidateCycles(organisationId, member.phoneNumber, tx);
    const thrift = await paymentModel.findThriftTarget(organisationId, member.phoneNumber, todayInLagos(), tx);
    const { lines, credit } = allocate(input.amount, candidates, thrift);

    const receivedAt = new Date();
    const payment = await paymentModel.createCashPayment(
      { organisationId, memberId, amount: input.amount, narration: input.note, receivedAt, loggedBy: userId },
      tx,
    );
    if (lines.length > 0) {
      await paymentModel.createContributions(
        lines.map((line) => ({ organisationId, ...line, paidAt: receivedAt, loggedBy: userId, paymentId: payment.id })),
        tx,
      );
    }
    if (credit > 0) {
      await paymentModel.createCredit({ organisationId, memberId, amount: credit, sourcePaymentId: payment.id }, tx);
    }

    const cycleInfo = new Map<string, paymentModel.ThriftRow>(candidates.map((c) => [c.cycleId, c]));
    if (thrift) cycleInfo.set(thrift.cycleId, thrift);
    return {
      payment,
      allocations: lines.map(({ cycleId, amount }) => {
        const { groupId: lineGroupId, groupName, cycleNumber, dueDate } = cycleInfo.get(cycleId)!;
        return { cycleId, groupId: lineGroupId, groupName, cycleNumber, dueDate, amount };
      }),
      credit,
    };
  });
}
